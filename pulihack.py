import asyncio
import aiohttp
import xml.etree.ElementTree as ET
import time
import ssl
from functools import lru_cache
import os
import pickle
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
import hashlib
from itertools import islice

# Constants for performance tuning
MAX_CONNECTIONS = 30
MAX_CONCURRENT_TASKS = 40
PROCESS_POOL_SIZE = max(1, multiprocessing.cpu_count() - 1)
REQUEST_TIMEOUT = 10  # seconds
BATCH_SIZE = 10  # number of pathways to process in parallel
MIN_REQUIRED_RELATIONS = 10  # minimum relations before early termination
MAX_RELATION_PATHWAYS = 15  # stop processing pathways after this many
CACHE_DIR = ".kegg_cache"  # directory for persistent cache

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

# Process pool for CPU-intensive tasks
process_pool = ProcessPoolExecutor(max_workers=PROCESS_POOL_SIZE)

# In-memory caches
api_cache = {}
gene_name_cache = {}
drug_name_cache = {}

def get_cache_path(key, prefix):
    """Get path for cached file."""
    hashed = hashlib.md5(key.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{prefix}_{hashed}.pkl")

def save_to_disk_cache(key, data, prefix):
    """Save data to disk cache."""
    try:
        cache_path = get_cache_path(key, prefix)
        with open(cache_path, 'wb') as f:
            pickle.dump(data, f)
    except Exception:
        pass  # Silently fail if caching fails

def load_from_disk_cache(key, prefix):
    """Load data from disk cache."""
    try:
        cache_path = get_cache_path(key, prefix)
        if os.path.exists(cache_path):
            with open(cache_path, 'rb') as f:
                return pickle.load(f)
    except Exception:
        pass
    return None

@lru_cache(maxsize=256)
def clean_gene_name(name):
    """Clean gene name by removing prefixes and suffixes."""
    name = name.replace("NAME (RefSeq)", "").strip()
    name = name.replace("NAME", "").strip()
    name = name.replace("(RefSeq)", "").strip()
    return name

@lru_cache(maxsize=256)
def clean_drug_name(name):
    """Clean drug name by removing prefixes."""
    return name.replace("NAME", "").strip()

async def get_with_cache(session, url):
    """Make a cached HTTP request with disk caching."""
    # Check in-memory cache first (fastest)
    if url in api_cache:
        return api_cache[url]
    
    # Check disk cache next
    disk_data = load_from_disk_cache(url, "api")
    if disk_data is not None:
        # Store in memory cache too
        api_cache[url] = disk_data
        return disk_data
    
    # Make actual request if not in any cache
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)) as response:
            if response.status != 200:
                return ""
            text = await response.text()
            
            # Save in both caches
            api_cache[url] = text
            save_to_disk_cache(url, text, "api")
            
            return text
    except asyncio.TimeoutError:
        print(f"Request timed out for {url}")
        return ""
    except Exception as e:
        print(f"Error fetching {url}: {str(e)}")
        return ""

async def get_gene_name(session, gene_code):
    """Get the name of a gene using the KEGG API with caching."""
    # Check memory cache
    if gene_code in gene_name_cache:
        return gene_name_cache[gene_code]
    
    # Check disk cache
    disk_data = load_from_disk_cache(gene_code, "gene")
    if disk_data is not None:
        gene_name_cache[gene_code] = disk_data
        return disk_data
    
    # Make API request
    url = f"https://rest.kegg.jp/get/{gene_code}"
    try:
        response_text = await get_with_cache(session, url)
        if not response_text:
            return "Unknown"
            
        # Extract line containing the name
        name_line = ""
        for line in response_text.strip().split('\n'):
            if line.startswith("NAME"):
                name_line = line
                break
                
        if name_line:
            name = name_line.partition("\t")[2] if "\t" in name_line else name_line
            name = clean_gene_name(name)
            
            # Save to both caches
            gene_name_cache[gene_code] = name
            save_to_disk_cache(gene_code, name, "gene")
            
            return name
        return "Unknown"
    except Exception as e:
        print(f"Error getting gene name for {gene_code}: {str(e)}")
        return "Unknown"

async def get_pathway_codes(session, gene_code):
    """Get pathway codes for a gene with caching."""
    # Check disk cache
    cache_key = f"pathway_{gene_code}"
    disk_data = load_from_disk_cache(cache_key, "path")
    if disk_data is not None:
        return disk_data
    
    url = f"https://rest.kegg.jp/link/pathway/{gene_code}"
    try:
        response_text = await get_with_cache(session, url)
        if not response_text:
            return []
            
        # More efficient string parsing
        result = []
        for line in response_text.strip().split('\n'):
            if '\t' in line:
                parts = line.split('\t', 2)  # Only split on first tab
                if len(parts) >= 2:
                    result.append(parts[1].strip())
        
        # Cache result
        save_to_disk_cache(cache_key, result, "path")
        return result
    except Exception as e:
        print(f"Error getting pathway codes for {gene_code}: {str(e)}")
        return []

async def get_drugs_for_gene(session, gene_code):
    """Get drugs for a gene with caching."""
    # Check disk cache
    cache_key = f"drugs_{gene_code}"
    disk_data = load_from_disk_cache(cache_key, "drug")
    if disk_data is not None:
        return disk_data
    
    url = f"https://rest.kegg.jp/link/drug/{gene_code}"
    try:
        response_text = await get_with_cache(session, url)
        if not response_text:
            return []
            
        # More efficient parsing
        result = []
        for line in response_text.strip().split('\n'):
            if '\t' in line:
                parts = line.split('\t', 2)  # Only split on first tab
                if len(parts) >= 2:
                    result.append(parts[1].strip())
        
        # Cache result
        save_to_disk_cache(cache_key, result, "drug")
        return result
    except Exception as e:
        print(f"Error getting drugs for {gene_code}: {str(e)}")
        return []

async def get_drug_name(session, drug_code):
    """Get the name of a drug with caching."""
    # Check memory cache
    if drug_code in drug_name_cache:
        return drug_name_cache[drug_code]
    
    # Check disk cache
    disk_data = load_from_disk_cache(drug_code, "drug_name")
    if disk_data is not None:
        drug_name_cache[drug_code] = disk_data
        return disk_data
    
    url = f"https://rest.kegg.jp/get/{drug_code}"
    try:
        response_text = await get_with_cache(session, url)
        if not response_text:
            return "Unknown"
            
        # Extract name from response
        name = "Unknown"
        lines = response_text.strip().split('\n')
        if len(lines) >= 2:
            name_line = lines[1]
            name = name_line.partition("\t")[2] if "\t" in name_line else name_line
            name = clean_drug_name(name)
        
        # Save to both caches
        drug_name_cache[drug_code] = name
        save_to_disk_cache(drug_code, name, "drug_name")
        
        return name
    except Exception as e:
        print(f"Error getting drug name for {drug_code}: {str(e)}")
        return "Unknown"

def parse_xml_worker(xml_data):
    """Worker function for parsing XML in a separate process."""
    xml_text, gene_id_to_find = xml_data
    
    if not xml_text or not xml_text.strip().startswith('<?xml'):
        return None, [], {}
    
    try:
        root = ET.fromstring(xml_text)
        
        # Extract pathway title
        title = "Unknown Pathway"
        for elem in root.findall(".//name"):
            title = elem.text
            break
            
        gene_id = None
        relations = []
        entry_names = {}
        
        # First pass - collect entries and find our gene
        for entry in root.findall('.//entry'):
            entry_id = entry.get('id')
            entry_name = entry.get('name')
            entry_type = entry.get('type', '')
            
            if not entry_id or not entry_name:
                continue
                
            # Store entry
            entry_names[entry_id] = entry_name
            
            # Check if this is our gene
            if (entry_type in ('gene', 'ortholog') or not entry_type) and (
                gene_id_to_find in entry_name or gene_id_to_find in entry_id):
                gene_id = entry_id
        
        # No gene found - stop processing
        if not gene_id:
            return None, [], {}
        
        # Second pass - find relations
        relation_set = set()  # Use set to avoid duplicates
        for relation in root.findall('.//relation'):
            entry1 = relation.get('entry1')
            entry2 = relation.get('entry2')
            
            # Check if this relation involves our gene
            if entry1 != gene_id and entry2 != gene_id:
                continue
                
            # Get subtypes
            subtypes = [subtype.get('name') for subtype in relation.findall('.//subtype') 
                        if subtype.get('name')]
            
            # Get the related gene
            other_entry_id = entry2 if entry1 == gene_id else entry1
            other_entry_name = entry_names.get(other_entry_id, "")
            
            if not other_entry_name or other_entry_name == "Unknown":
                continue
                
            # Extract first code if multiple
            if " " in other_entry_name:
                other_entry_name = other_entry_name.split(" ")[0]
            
            # Must be a human gene
            if not other_entry_name.startswith('hsa:'):
                continue
                
            # Add to relations if valid
            relation_type = '/'.join(subtypes) if subtypes else "association"
            
            # Use tuple as key for deduplication
            relation_key = (other_entry_id, other_entry_name, relation_type)
            if relation_key not in relation_set:
                relation_set.add(relation_key)
                relations.append({
                    'entry_id': other_entry_id,
                    'entry_name': other_entry_name,
                    'relation_type': relation_type,
                    'pathway': title
                })
        
        return gene_id, relations, entry_names
        
    except Exception as e:
        return None, [], {}

async def process_pathway(session, pathway_url, gene_name):
    """Process a pathway to find relations with caching."""
    # Check disk cache
    cache_key = f"pathway_result_{pathway_url}_{gene_name}"
    disk_data = load_from_disk_cache(cache_key, "parsed")
    if disk_data is not None:
        return disk_data
    
    xml_text = await get_with_cache(session, pathway_url)
    gene_id_to_find = gene_name.split(':')[1] if ':' in gene_name else gene_name
    
    # Use process pool for CPU-intensive XML parsing
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        process_pool, 
        parse_xml_worker, 
        (xml_text, gene_id_to_find)
    )
    
    # Cache result
    save_to_disk_cache(cache_key, result, "parsed")
    return result

async def process_all_pathways(session, gene_name):
    """Process pathways for a gene with early termination."""
    t0 = time.time()
    
    # Check disk cache for overall result
    cache_key = f"all_relations_{gene_name}"
    disk_data = load_from_disk_cache(cache_key, "relations")
    if disk_data is not None:
        print(f"Using cached relations for {gene_name}")
        return disk_data
    
    # Get pathway codes
    pathway_codes = await get_pathway_codes(session, gene_name)
    if not pathway_codes:
        print(f"No pathway codes found for {gene_name}")
        return []
    
    print(f"Found {len(pathway_codes)} pathways for {gene_name} in {time.time()-t0:.2f}s")
    
    # Generate KEGG API URLs for pathways (only process a subset if many)
    pathway_urls = [
        f"https://rest.kegg.jp/get/path:{code.split(':')[1] if ':' in code else code}/kgml"
        for code in pathway_codes[:MAX_RELATION_PATHWAYS]  # Limit number of pathways
    ]
    
    # Process pathways in batches
    all_relations = []
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
    early_termination = False
    
    for i in range(0, len(pathway_urls), BATCH_SIZE):
        if early_termination:
            break
            
        batch = pathway_urls[i:i+BATCH_SIZE]
        
        # Create tasks with semaphore for concurrency control
        async def process_with_semaphore(url):
            async with semaphore:
                return await process_pathway(session, url, gene_name)
                
        # Create tasks for current batch
        tasks = [process_with_semaphore(url) for url in batch]
        
        # Process batch as tasks complete
        for future in asyncio.as_completed(tasks):
            gene_id, relations, _ = await future
            
            if relations:
                all_relations.extend(relations)
                
            # Early termination if we have enough relations
            if len(all_relations) >= MIN_REQUIRED_RELATIONS:
                early_termination = True
                break
    
    # Cache the final result
    save_to_disk_cache(cache_key, all_relations, "relations")
    
    print(f"Found {len(all_relations)} relations in {time.time()-t0:.2f}s")
    if early_termination:
        print(f"Early termination activated after finding {len(all_relations)} relations")
        
    return all_relations

async def get_related_genes_and_drugs(session, gene_name):
    """Get related genes and their drugs with optimized processing."""
    t0 = time.time()
    
    # Check disk cache for final result
    cache_key = f"gene_drugs_{gene_name}"
    disk_data = load_from_disk_cache(cache_key, "result")
    if disk_data is not None:
        print(f"Using cached results for {gene_name}")
        return disk_data
    
    # Process all pathways
    all_relations = await process_all_pathways(session, gene_name)
    
    # No relations found
    if not all_relations:
        print(f"No relations found for {gene_name}")
        return {}
    
    # Use dict for deduplication with gene_code as key
    gene_relation_map = {}
    for relation in all_relations:
        gene_code = relation['entry_name']
        
        # Skip if it's our input gene
        if gene_code == gene_name:
            continue
            
        # Add to map if not there or if relation is activation
        relation_type = relation['relation_type']
        if gene_code not in gene_relation_map or 'activation' in relation_type:
            gene_relation_map[gene_code] = relation
    
    # Sort genes by relation type priority
    def get_priority(relation):
        rel_type = relation['relation_type']
        # Priority order: activation > inhibition > expression > binding > other
        if 'activation' in rel_type: return 0
        elif 'inhibition' in rel_type: return 1
        elif 'expression' in rel_type: return 2
        elif 'binding/association' in rel_type: return 3
        else: return 4
    
    # Get top relations
    sorted_relations = sorted(gene_relation_map.values(), key=get_priority)
    top_relations = list(islice(sorted_relations, 5))  # More efficient than slicing
    
    print(f"Selected {len(top_relations)} top relations in {time.time()-t0:.2f}s")
    
    # Get gene names and drugs in parallel
    gene_drugs_map = {}
    drug_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
    
    # Process genes in parallel
    async def process_gene(relation):
        gene_code = relation['entry_name']
        gene_full_name = await get_gene_name(session, gene_code)
        
        # Skip invalid genes
        if gene_full_name == "Unknown":
            return None, None
        
        # Get drugs for this gene
        drug_codes = await get_drugs_for_gene(session, gene_code)
        
        if not drug_codes:
            return gene_full_name, []
            
        # Process drug names in parallel
        async def get_drug_with_semaphore(code):
            async with drug_semaphore:
                return await get_drug_name(session, code)
                
        drug_tasks = [get_drug_with_semaphore(code) for code in drug_codes]
        drug_names = await asyncio.gather(*drug_tasks)
        
        # Filter valid drugs and deduplicate
        valid_drugs = sorted(set(name for name in drug_names if name != "Unknown"))
        return gene_full_name, valid_drugs
    
    # Process all genes in parallel
    gene_tasks = [process_gene(relation) for relation in top_relations]
    gene_results = await asyncio.gather(*gene_tasks)
    
    # Build final map
    for gene_name, drugs in gene_results:
        if gene_name is not None:  # Skip failed genes
            gene_drugs_map[gene_name] = drugs
    
    # Cache final result
    save_to_disk_cache(cache_key, gene_drugs_map, "result")
    
    return gene_drugs_map

async def main():
    start_time = time.time()
    gene_name = "hsa:5747"  # Protein tyrosine kinase 2
    
    # Configure SSL context
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    # Configure connection pooling
    connector = aiohttp.TCPConnector(
        ssl=ssl_context,
        limit=MAX_CONNECTIONS,
        ttl_dns_cache=300,  # DNS cache TTL
        use_dns_cache=True,
        keepalive_timeout=60  # Keep connections alive
    )
    
    # Configure timeout and retry options
    timeout = aiohttp.ClientTimeout(
        total=30,
        connect=10,
        sock_connect=10,
        sock_read=10
    )
    
    async with aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        raise_for_status=False  # Don't raise exceptions for non-200 responses
    ) as session:
        # Get gene name
        gene_full_name = await get_gene_name(session, gene_name)
        print(f"\nGENE NAME: {gene_full_name}")
        
        # Get related genes and drugs
        gene_drugs_map = await get_related_genes_and_drugs(session, gene_name)
        
        # Print results
        print("\nSIMILAR GENES AND THEIR COMPATIBLE DRUGS:")
        
        if not gene_drugs_map:
            print("No similar genes found.")
        else:
            for i, (gene, drugs) in enumerate(gene_drugs_map.items(), 1):
                print(f"\n{i}. {gene}")
                
                if drugs:
                    print(f"   Compatible drugs ({len(drugs)}):")
                    for j, drug in enumerate(drugs, 1):
                        print(f"   {j}. {drug}")
                else:
                    print("   No compatible drugs found")
    
    end_time = time.time()
    execution_time = end_time - start_time
    print(f"\nEXECUTION TIME: {execution_time:.2f} seconds")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Clean up process pool
        process_pool.shutdown(wait=False)
