/**
 * KEGG Gene and Drug Finder
 * Simplified implementation with direct API access
 */

// Configuration constants
const CONFIG = {
  DEBUG_MODE: true,
  REQUEST_TIMEOUT: 10000,
  RETRY_ATTEMPTS: 3
};

// Helper function for debugging
function debug(...args) {
  if (CONFIG.DEBUG_MODE) {
    console.log(...args);
  }
}

// Main KEGG API class
class KeggAPI {
  constructor() {
    // For tracking pending requests
    this.pendingRequests = new Map();
    
    // Metrics tracking
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      totalTime: 0
    };
    
    // Display CO
    // 
    // S information message
    this._showCorsMessage();
    
    debug("KeggAPI initialized");
  }
  
  // Calculate repurposing score for a drug
  calculateRepurposingScore(drug, baseGeneDiseases, relatedGeneDiseases, relation = "Pathway") {
    // Base score for all drugs is 0.3 (on a 0-1 scale)
    let score = 0.3;
    
    debug(`Calculating repurposing score for drug ${drug.code}`);
    
    // Add 0.5 points if both genes share at least one disease
    if (baseGeneDiseases && relatedGeneDiseases && baseGeneDiseases.length > 0 && relatedGeneDiseases.length > 0) {
      // Create sets of disease codes for efficient comparison
      const baseDiseaseCodes = new Set(baseGeneDiseases.map(d => d.code));
      const relatedDiseaseCodes = new Set(relatedGeneDiseases.map(d => d.code));
      
      // Check for intersection
      let hasSharedDisease = false;
      for (const code of baseDiseaseCodes) {
        if (relatedDiseaseCodes.has(code)) {
          hasSharedDisease = true;
          break;
        }
      }
      
      if (hasSharedDisease) {
        score += 0.5;
        debug(`+0.5 points for shared disease between genes for drug ${drug.code}`);
      }
    }
    
    // Adjust score based on relationship type
    if (relation && relation.toLowerCase().includes("activ")) {
      // +0.2 for activation relationship
      score += 0.2;
      debug(`+0.2 points for activation relationship for drug ${drug.code}`);
    } else if (relation && relation.toLowerCase().includes("inhib")) {
      // -0.1 for inhibition relationship
      score -= 0.1;
      debug(`-0.1 point for inhibition relationship for drug ${drug.code}`);
    }
    
    // Ensure the score is within 0-1 range
    const finalScore = Math.max(0, Math.min(1, score));
    
    debug(`Final repurposing score for drug ${drug.code}: ${finalScore.toFixed(2)}`);
    return finalScore;
  }
  
  // Show information about KEGG API
  _showCorsMessage() {
    const messageEl = document.getElementById('message');
    if (messageEl) {
      messageEl.innerHTML = `<strong>KEGG API Access:</strong> This app uses CORS proxies to access the KEGG API since direct browser access may be blocked by security policies. If results don't appear, try enabling the CORS proxy access in your browser or use the browser's developer console to see specific errors.`;
      messageEl.className = 'message info';
      messageEl.style.display = 'block';
      
      // Show longer to give user time to read
    setTimeout(() => {
        messageEl.style.display = 'none';
      }, 15000);
    }
  }
  
  // Clean text helper
  cleanText(text, prefix = "") {
    if (!text) return "";
    return text.replace(prefix, "").trim();
  }
  
  // Fetch data with better error handling
  async fetchData(url) {
    debug(`Fetching: ${url}`);
    
    // Check for pending requests
    if (this.pendingRequests.has(url)) {
      return this.pendingRequests.get(url);
    }
    
    // Create new promise for this request
    const requestPromise = this._fetchWithRetry(url);
    this.pendingRequests.set(url, requestPromise);
    
    try {
      const result = await requestPromise;
      this.pendingRequests.delete(url);
      return result;
    } catch (error) {
      this.pendingRequests.delete(url);
      throw error;
    }
  }
  
  // Fetch with simple retry logic
  async _fetchWithRetry(url, retryCount = 0) {
    if (retryCount >= CONFIG.RETRY_ATTEMPTS) {
      throw new Error("Failed to fetch data after all attempts");
    }
    
    // Start timing the request
    const startTime = performance.now();
    
    try {
      // Direct API call - user has CORS extension installed
      debug(`Fetch attempt ${retryCount + 1} for ${url}`);
      const response = await fetch(url, { 
        method: 'GET',
        headers: {
          'Accept': 'text/plain'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.text();
      debug(`Fetch successful for ${url} (${data.length} bytes)`);
      this.metrics.successCount++;
      this.metrics.totalTime += (performance.now() - startTime);
      return data;
    } catch (error) {
      debug(`Fetch attempt ${retryCount + 1} failed: ${error.message}`);
      this.metrics.failureCount++;
      
      // Wait a moment before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Recursively retry
      return this._fetchWithRetry(url, retryCount + 1);
    }
  }
  
  // Update metrics for tracking API request performance
  _updateMetrics(result, startTime = null) {
    this.metrics.requestCount++;
    
    if (result === 'success' && startTime) {
      const elapsedTime = performance.now() - startTime;
      this.metrics.successCount++;
      this.metrics.totalTime += elapsedTime;
      debug(`Request completed in ${elapsedTime.toFixed(2)}ms`);
    } else if (result === 'error') {
      this.metrics.failureCount++;
    }
  }
  
  // Get gene name from KEGG
  async getGeneName(geneCode) {
    try {
      const formattedGeneCode = geneCode.includes(':') ? geneCode : `hsa:${geneCode}`;
      const url = `https://rest.kegg.jp/get/${formattedGeneCode}`;
      const response = await this.fetchData(url);
      
      if (!response || response.includes('No such data')) {
        return "Unknown";
      }
      
      const nameMatch = response.match(/NAME\s+(.*?)\n/);
      return nameMatch ? this.cleanText(nameMatch[1], "(RefSeq)") : "Unknown";
    } catch (error) {
      debug(`Error getting gene name: ${error.message}`);
      return "Unknown";
    }
  }
  
  // Look up gene ID by name
  async findGeneByName(geneName) {
    try {
      debug(`Looking up gene by name: ${geneName}`);
      const url = `https://rest.kegg.jp/find/genes/${encodeURIComponent(geneName)}`;
      const response = await this.fetchData(url);
      
      if (!response || response.trim() === '') {
        debug(`No genes found with name: ${geneName}`);
        return null;
      }
      
      // Parse the response - typically tab-separated format: ID[tab]Description
      const lines = response.trim().split('\n');
      const results = [];
      const exactMatches = [];
      
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          // Extract human gene IDs (starting with hsa:)
          const geneId = parts[0].trim();
          const description = parts[1].trim();
          
          // Only include human genes
          if (geneId.startsWith('hsa:')) {
            const result = {
              id: geneId,
              description: description
            };
            
            // Check for the pattern "{geneName}," which indicates an exact gene name match
            if (description.includes(`${geneName},`)) {
              debug(`Found EXACT FORMAT MATCH for "${geneName}," in: ${description}`);
              exactMatches.unshift(result); // Add to beginning of array to prioritize
              continue; // Skip other checks for this match
            }
            
            // Look for pattern: symbol:GENENAME
            const symbolMatch = description.match(/symbol:([\w\d-]+)/i);
            if (symbolMatch) {
              const symbol = symbolMatch[1];
              if (symbol.toUpperCase() === geneName.toUpperCase()) {
                debug(`Found exact match for ${geneName}: ${geneId} (${symbol})`);
                exactMatches.push(result);
                continue; // Skip adding to regular results
              }
            }
            
            // Also check if the gene ID itself contains the exact name
            if (geneId.includes(`:${geneName}`)) {
              debug(`Found exact match in ID for ${geneName}: ${geneId}`);
              exactMatches.push(result);
              continue; // Skip adding to regular results
            }
            
            results.push(result);
          }
        }
      }
      
      debug(`Found ${results.length} total matches and ${exactMatches.length} exact matches for "${geneName}"`);
      
      // Return exact matches if any, otherwise return all results
      return exactMatches.length > 0 ? exactMatches : results;
    } catch (error) {
      debug(`Error finding gene by name: ${error.message}`);
      return null;
    }
  }
  
  // Process a gene by name, first finding its ID then processing it
  async processGeneByName(geneName) {
    console.log(`Finding gene by name: ${geneName}`);
    const genes = await this.findGeneByName(geneName);
    
    if (!genes || genes.length === 0) {
      console.error("No genes found with that name");
      throw new Error("No genes found with that name");
    }
    
    // Check if we have multiple matches
    if (genes.length > 1) {
      console.log(`Found ${genes.length} matches for "${geneName}". Using the first match: ${genes[0].id}`);
      
      // Create a message showing all the matches
      const matchesInfo = genes.slice(0, 5).map(g => `${g.id} (${g.description.split(';')[0]})`).join(', ');
      const message = `Multiple genes found matching "${geneName}". Using ${genes[0].id}.\nOther matches: ${matchesInfo}${genes.length > 5 ? ` and ${genes.length - 5} more...` : ''}`;
      
      // Display a warning but continue with the first match
      alert(message);
    }
    
    console.log(`Using gene: ${genes[0].id} - ${genes[0].description}`);
    return this.processGene(genes[0].id);
  }
  
  // Get KO (KEGG Orthology) information for a gene
  async getGeneKO(geneCode) {
    try {
      const formattedGeneCode = geneCode.includes(':') ? geneCode : `hsa:${geneCode}`;
      // Use the link API to get KO identifiers for this gene
      const url = `https://rest.kegg.jp/link/ko/${formattedGeneCode}`;
      debug(`Fetching KO for ${formattedGeneCode}: ${url}`);
      const response = await this.fetchData(url);
      
      if (!response || response.trim() === '') {
        debug(`No KO data found for ${formattedGeneCode}`);
        return [];
      }
      
      // Parse KO identifiers from response
      // Format: hsa:5747    ko:K05698
      const koIds = response.trim().split('\n')
        .map(line => {
          const parts = line.split('\t');
          return parts.length >= 2 ? parts[1] : null;
        })
        .filter(Boolean);
      
      debug(`Found ${koIds.length} KO identifiers for ${formattedGeneCode}`);
      
      // Get detailed information for each KO
      const koDetails = [];
      for (const koId of koIds) {
        try {
          const koUrl = `https://rest.kegg.jp/get/${koId}`;
          const koResponse = await this.fetchData(koUrl);
          
          if (koResponse) {
            // Extract name for this KO
            const nameMatch = koResponse.match(/NAME\s+(.*?)(?:\n|$)/);
            const name = nameMatch ? nameMatch[1].trim() : koId;
            
            koDetails.push({
              id: koId,
              name: name
            });
            
            debug(`Added KO: ${koId} - ${name}`);
          }
        } catch (koError) {
          debug(`Error fetching KO detail ${koId}: ${koError.message}`);
        }
      }
      
      return koDetails;
    } catch (error) {
      debug(`Error getting KO data: ${error.message}`);
      return [];
    }
  }
  
  // Get diseases associated with a gene
  async getGeneDiseases(geneCode) {
    try {
      const formattedGeneCode = geneCode.includes(':') ? geneCode : `hsa:${geneCode}`;
      // Use the link API to get disease identifiers for this gene
      const url = `https://rest.kegg.jp/link/disease/${formattedGeneCode}`;
      debug(`Fetching diseases for ${formattedGeneCode}: ${url}`);
      const response = await this.fetchData(url);
      
      if (!response || response.trim() === '') {
        debug(`No disease data found for ${formattedGeneCode}`);
        return [];
      }
      
      // Parse disease identifiers from response
      // Format: hsa:5747    ds:H00123
      const diseaseIds = response.trim().split('\n')
        .map(line => {
          const parts = line.split('\t');
          return parts.length >= 2 ? parts[1] : null;
        })
        .filter(Boolean);
      
      debug(`Found ${diseaseIds.length} disease identifiers for ${formattedGeneCode}`);
      
      // Get detailed information for each disease
      const diseaseDetails = [];
      for (const diseaseId of diseaseIds) {
        try {
          const diseaseUrl = `https://rest.kegg.jp/get/${diseaseId}`;
          const diseaseResponse = await this.fetchData(diseaseUrl);
          
          if (diseaseResponse) {
            // Extract name for this disease
            const nameMatch = diseaseResponse.match(/NAME\s+(.*?)(?:\n|$)/);
            const name = nameMatch ? nameMatch[1].trim() : diseaseId;
            
            diseaseDetails.push({
              code: diseaseId,
              name: name
            });
            
            debug(`Added disease: ${diseaseId} - ${name}`);
          }
        } catch (diseaseError) {
          debug(`Error fetching disease detail ${diseaseId}: ${diseaseError.message}`);
        }
      }
      
      return diseaseDetails;
    } catch (error) {
      debug(`Error getting disease data: ${error.message}`);
      return [];
    }
  }
  
  // Get related genes and drugs - main function
  async getRelatedGenesAndDrugs(geneCode) {
    try {
      const formattedGeneCode = geneCode.includes(':') ? geneCode : `hsa:${geneCode}`;
      
      // Get gene name to verify it exists
      debug(`Fetching gene info for ${formattedGeneCode}`);
      const geneName = await this.getGeneName(formattedGeneCode);
      if (geneName === "Unknown") {
        debug(`Gene ${formattedGeneCode} not found`);
        return { error: "Invalid Gene", message: `Gene ${geneCode} not found` };
      }
      
      debug(`Processing gene: ${formattedGeneCode} (${geneName})`);
      
      // Get KO information for the base gene
      const geneKO = await this.getGeneKO(formattedGeneCode);
      debug(`Found ${geneKO.length} KO entries for gene ${formattedGeneCode}`);
      
      // Get diseases associated with the base gene
      const geneDiseases = await this.getGeneDiseases(formattedGeneCode);
      debug(`Found ${geneDiseases.length} diseases associated with gene ${formattedGeneCode}`);
      
      // 1. Get pathways for gene - correct endpoint format
      const pathwaysUrl = `https://rest.kegg.jp/link/pathway/${formattedGeneCode}`;
      debug(`Fetching pathways: ${pathwaysUrl}`);
      const pathwaysResponse = await this.fetchData(pathwaysUrl);
      
      if (!pathwaysResponse || pathwaysResponse.trim() === '') {
        debug(`No pathway data found for ${formattedGeneCode}`);
        return { 
          geneName, 
          geneKO,
          diseases: geneDiseases,
          drugs: [], 
          relatedGenes: {},
          error: "No Data",
          message: "No pathway data found for this gene"
        };
      }
      
      // Parse pathways - ensure correct format processing
      const pathways = pathwaysResponse.trim().split('\n')
        .map(line => {
          const parts = line.split('\t');
          return parts.length >= 2 ? parts[1] : null;
        })
        .filter(Boolean);
      
      debug(`Found ${pathways.length} pathways for gene: ${formattedGeneCode}`);
      
      // 2. Get drugs for the base gene - handle failures gracefully
      let baseDrugs = [];
      let drugsWithInfo = [];
      
      try {
        const drugsUrl = `https://rest.kegg.jp/link/drug/${formattedGeneCode}`;
        debug(`Fetching drugs for base gene: ${drugsUrl}`);
        const drugsResponse = await this.fetchData(drugsUrl);
        
        if (drugsResponse && drugsResponse.trim() !== '') {
          baseDrugs = drugsResponse.trim().split('\n')
            .map(line => {
              const parts = line.split('\t');
              return parts.length >= 2 ? parts[1] : null;
            })
            .filter(Boolean);
          
          debug(`Found ${baseDrugs.length} drugs for base gene ${formattedGeneCode}`);
          
          // 3. Get drug details - only if we found drugs
          if (baseDrugs.length > 0) {
            drugsWithInfo = await this._fetchDrugDetails(baseDrugs, geneDiseases);
            
            // Add base repurposing score to each drug of the base gene
            for (const drug of drugsWithInfo) {
              // Base gene drugs get a default repurposing score of 0.3 (on 0-1 scale)
              drug.repurposingScore = 0.3;
              debug(`Set base repurposing score ${drug.repurposingScore.toFixed(2)} for drug ${drug.code} of base gene`);
            }
            
            debug(`Processed ${drugsWithInfo.length} drugs with details for base gene: ${formattedGeneCode}`);
          } else {
            debug(`No drugs found for gene: ${formattedGeneCode}`);
          }
        } else {
          debug(`No drug information available for gene: ${formattedGeneCode}`);
        }
      } catch (error) {
        // Continue even if drug fetching fails
        debug(`Error fetching drug information: ${error.message} - continuing with pathway analysis`);
      }
      
      // 4. For each pathway, get related genes (limit to first 2 pathways)
      const relatedGenes = {};
      const pathwaysToProcess = pathways.slice(0, 2);
      
      debug(`Processing ${pathwaysToProcess.length} pathways for related genes`);
      
      for (const pathway of pathwaysToProcess) {
        await this._processPathway(pathway, formattedGeneCode, relatedGenes, geneDiseases);
      }
      
      debug(`Completed processing with ${Object.keys(relatedGenes).length} related genes`);
      
      // Create final result
      return {
        geneName,
        geneKO,
        diseases: geneDiseases,
        drugs: baseDrugs,
        drugsWithInfo: drugsWithInfo,
        relatedGenes: relatedGenes
      };
    } catch (error) {
      debug(`Error getting related genes and drugs: ${error.message}`);
      return { error: "Processing Error", message: error.message };
    }
  }
  
  // Helper to fetch drug details
  async _fetchDrugDetails(drugCodes, baseGeneDiseases = []) {
    const drugsWithInfo = [];
    debug(`Fetching details for ${drugCodes.length} drugs`);
    
    for (const drugCode of drugCodes) {
      try {
        // Make sure we're using valid drug codes (typically starting with dr:)
        if (!drugCode || (!drugCode.startsWith('dr:') && !drugCode.match(/^D\d+$/))) {
          debug(`Skipping invalid drug code: ${drugCode}`);
          continue;
        }
        
        // Format drug code properly for API call
        const formattedDrugCode = drugCode.startsWith('dr:') ? drugCode : `dr:${drugCode}`;
        
        // Use the correct KEGG API endpoint
        const drugUrl = `https://rest.kegg.jp/get/${formattedDrugCode}`;
        debug(`Fetching drug details: ${drugUrl}`);
        const drugResponse = await this.fetchData(drugUrl);
        
        if (!drugResponse || drugResponse.trim() === '') {
          debug(`No data received for drug ${formattedDrugCode}`);
          continue;
        }
        
        // Initialize drug info
        const drugInfo = {
          code: drugCode,
          name: drugCode,
          diseases: [],
          repurposingScore: 3 // Base score for all drugs is 3
        };
        
        // Extract drug name first
        const nameMatch = drugResponse.match(/NAME\s+(.*?)(?:\n|$)/);
        if (nameMatch) {
          drugInfo.name = this.cleanText(nameMatch[1], "NAME");
          debug(`Found drug name: ${drugInfo.name}`);
        }
        
        // Log entire raw response for deep debugging
        if (CONFIG.DEBUG_MODE) {
          debug(`Raw drug response for ${drugCode} (first 100 chars): ${drugResponse.substring(0, 100)}...`);
        }
        
        // NEW APPROACH: Extract the entire DISEASE section first
        const diseaseSectionMatch = drugResponse.match(/DISEASE([\s\S]*?)(?=\n[A-Z]+|\n\n|$)/);
        
        if (diseaseSectionMatch) {
          const entireDiseaseSection = diseaseSectionMatch[0];
          debug(`Found DISEASE section for ${drugCode} (${entireDiseaseSection.length} chars)`);
          
          // Find all disease codes in the section using a global regex
          const diseaseCodeMatches = entireDiseaseSection.match(/\[DS:([\w\d]+)\]/g) || [];
          debug(`Found ${diseaseCodeMatches.length} disease code references`);
          
          // Process all lines in the disease section
          const diseaseLines = entireDiseaseSection.split('\n')
            .filter(line => line.trim().length > 0);
          
          // Track diseases we've already processed (to avoid duplicates)
          const processedCodes = new Set();
          
          // Process each line for disease information
          for (const line of diseaseLines) {
            const dsMatch = line.match(/\[DS:([\w\d]+)\]/);
            if (dsMatch) {
              const diseaseCode = dsMatch[1];
              
              // Skip if we've already processed this disease code
              if (processedCodes.has(diseaseCode)) continue;
              processedCodes.add(diseaseCode);
              
              // Extract disease name - everything before the DS code
              // First, remove the DISEASE header if present
              let diseaseName = line.replace(/^DISEASE\s+/, '')
                                   .replace(/\[DS:[\w\d]+\].*$/, '')
                                   .trim();
              
              // Handle lines where the disease code comes first (indented continuation lines)
              if (!diseaseName && line.trim().startsWith('[')) {
                // Try to find the disease name in previous lines
                const lineIndex = diseaseLines.indexOf(line);
                if (lineIndex > 0) {
                  diseaseName = diseaseLines[lineIndex - 1]
                    .replace(/^DISEASE\s+/, '')
                    .trim();
                }
              }
              
              // Remove any parenthesized text at the end of the disease name
              diseaseName = diseaseName.replace(/\s+\([^)]*\)$/, '').trim();
              
              // Add the disease to our list
              if (diseaseName) {
                drugInfo.diseases.push({
                  code: diseaseCode,
                  name: diseaseName
                });
                debug(`Found disease: ${diseaseCode} - ${diseaseName}`);
              } else {
                // Fallback if we couldn't extract a name
                drugInfo.diseases.push({
                  code: diseaseCode,
                  name: `Disease ${diseaseCode}`
                });
                debug(`Found disease code ${diseaseCode} without name`);
              }
            }
          }
        } else {
          debug(`No DISEASE section found in drug ${drugCode}`);
        }
        
        drugsWithInfo.push(drugInfo);
        debug(`Processed drug ${drugCode} - found ${drugInfo.diseases.length} associated diseases`);
    } catch (error) {
        debug(`Error processing drug ${drugCode}: ${error.message}`);
      }
    }
    
    return drugsWithInfo;
  }
  
  // Helper to process pathway and related genes
  async _processPathway(pathway, sourceGeneCode, relatedGenes, baseGeneDiseases = []) {
    try {
      debug(`Processing pathway: ${pathway}`);
      
      // Ensure pathway has the correct format (should be path:hsa00000)
      // Pathway IDs from KEGG link responses often look like "hsa04510" without the "path:" prefix
      const formattedPathway = pathway.includes(':') ? pathway : 
        (pathway.match(/^hsa\d+$/) ? `path:${pathway}` : pathway);
      
      // Get pathway info - using proper GET endpoint
      const pathwayInfoUrl = `https://rest.kegg.jp/get/${formattedPathway}`;
      debug(`Fetching pathway info: ${pathwayInfoUrl}`);
      const pathwayInfoResponse = await this.fetchData(pathwayInfoUrl);
      
      let pathwayName = formattedPathway;
      if (pathwayInfoResponse) {
        // Standard text parsing for KEGG flat file format
        const nameMatch = pathwayInfoResponse.match(/NAME\s+(.*?)\n/);
        if (nameMatch) pathwayName = nameMatch[1].trim();
        debug(`Pathway name: ${pathwayName}`);
      }
      
      // Extract the pathway ID without the "path:" prefix for the correct API call
      // If input is "path:hsa01521", we need just "hsa01521" for the API call
      const pathwayId = pathway.includes(':') ? pathway.split(':')[1] : pathway;
      
      // Get genes in this pathway - using correct LINK endpoint format: /link/hsa/{pathway_id}
      const pathwayGenesUrl = `https://rest.kegg.jp/link/hsa/${pathwayId}`;
      debug(`Fetching pathway genes: ${pathwayGenesUrl}`);
      const pathwayGenesResponse = await this.fetchData(pathwayGenesUrl);
      
      if (!pathwayGenesResponse || pathwayGenesResponse.trim() === '') {
        debug(`No genes found for pathway ${formattedPathway}`);
        return;
      }
      
      // Parse gene entries from the response using standard KEGG tab-separated format
      // KEGG response format for this endpoint is: hsa01521\thsa:5747
      const genesInPathway = pathwayGenesResponse.trim().split('\n')
        .map(line => {
          const parts = line.split('\t');
          // Ensure we're getting a valid gene ID (should start with hsa:)
          if (parts.length >= 2 && parts[1].includes('hsa:')) {
            return parts[1]; // The second column has the gene ID
          }
          return null;
        })
        .filter(gene => gene && gene !== sourceGeneCode);
      
      debug(`Found ${genesInPathway.length} genes in pathway ${formattedPathway}`);
      
      // Process up to 3 related genes per pathway (to keep it faster)
      const genesToProcess = genesInPathway.slice(0, 3);
      debug(`Processing genes: ${genesToProcess.join(', ')}`);
      
      for (const relatedGene of genesToProcess) {
        // Skip if already processed
        if (relatedGenes[relatedGene]) {
          debug(`Gene ${relatedGene} already processed, skipping`);
        continue;
      }
        
        try {
          // Get gene name and details
          debug(`Getting name for gene ${relatedGene}`);
          const relatedGeneName = await this.getGeneName(relatedGene);
          if (relatedGeneName === "Unknown") {
            debug(`Unable to get name for gene ${relatedGene}, skipping`);
            continue;
          }
          
          debug(`Found related gene: ${relatedGene} (${relatedGeneName})`);
          
          // Get KO information for the related gene
          const relatedGeneKO = await this.getGeneKO(relatedGene);
          debug(`Found ${relatedGeneKO.length} KO entries for related gene ${relatedGene}`);
          
          // Get diseases associated with the related gene
          const relatedGeneDiseases = await this.getGeneDiseases(relatedGene);
          debug(`Found ${relatedGeneDiseases.length} diseases for related gene ${relatedGene}`);
          
          // Look for specific relationship in pathway name or function
          let relation = "Pathway";
          if (pathwayName.toLowerCase().includes("activ")) {
            relation = "Activation";
          } else if (pathwayName.toLowerCase().includes("inhib")) {
            relation = "Inhibition";
          }
          
          // Initialize with basic info in case drug fetch fails
          relatedGenes[relatedGene] = {
            geneName: relatedGeneName,
            relation: relation,
            pathway: pathwayName,
            ko: relatedGeneKO,
            diseases: relatedGeneDiseases,
            drugs: [],
            drugsWithInfo: []
          };
          
          try {
            // Get drugs for this gene
            const relatedDrugsUrl = `https://rest.kegg.jp/link/drug/${relatedGene}`;
            debug(`Fetching drugs for related gene ${relatedGene}: ${relatedDrugsUrl}`);
            const relatedDrugsResponse = await this.fetchData(relatedDrugsUrl);
            
            // Parse drug codes using standard KEGG tab-separated format
            // Format: hsa:5747\tdr:D00036
            let drugCodes = [];
            
            if (relatedDrugsResponse && relatedDrugsResponse.trim()) {
              // Standard text format
              drugCodes = relatedDrugsResponse.trim().split('\n')
                .map(line => {
                  const parts = line.split('\t');
                  // Verify it's a valid drug ID (should be dr:DXXXXX)
                  if (parts.length >= 2 && (parts[1].startsWith('dr:') || parts[1].match(/^D\d+$/))) {
                    return parts[1]; // The second column has the drug ID
                  }
                  return null;
                })
                .filter(Boolean);
              
              debug(`Found ${drugCodes.length} drug codes for gene ${relatedGene}: ${drugCodes.join(', ')}`);
            } else {
              debug(`No drug data found for gene ${relatedGene}`);
            }
            
            // Update gene entry with drug codes
            relatedGenes[relatedGene].drugs = drugCodes;
            
            // Get drug details only if we have drug codes
            if (drugCodes.length > 0) {
              debug(`Found ${drugCodes.length} drugs for gene ${relatedGene}, fetching details`);
              const drugsWithInfo = await this._fetchDrugDetails(drugCodes, relatedGeneDiseases);
              
              // Calculate repurposing score for each drug
              for (const drug of drugsWithInfo) {
                // Calculate repurposing score
                drug.repurposingScore = this.calculateRepurposingScore(
                  drug, 
                  baseGeneDiseases, 
                  relatedGeneDiseases,
                  relation
                );
                debug(`Set repurposing score ${drug.repurposingScore} for drug ${drug.code} of gene ${relatedGene}`);
              }
              
              // Sort drugs by repurposing score (highest first)
              drugsWithInfo.sort((a, b) => b.repurposingScore - a.repurposingScore);
              
              relatedGenes[relatedGene].drugsWithInfo = drugsWithInfo;
              debug(`Added ${drugsWithInfo.length} drugs with details to gene ${relatedGene}`);
            } else {
              debug(`No drugs found for gene ${relatedGene}`);
            }
          } catch (drugError) {
            debug(`Error fetching drugs for related gene ${relatedGene}: ${drugError.message}`);
            // Gene info still preserved even if drug fetch fails
          }
        } catch (geneError) {
          debug(`Error processing related gene ${relatedGene}: ${geneError.message}`);
        }
      }
    } catch (error) {
      debug(`Error processing pathway ${pathway}: ${error.message}`);
    }
  }
  
  // Get performance metrics
  getPerformanceMetrics() {
    const totalRequests = this.metrics.requestCount;
    const successRate = totalRequests > 0 ? 
      (this.metrics.successCount / totalRequests) * 100 : 0;
    const avgRequestTime = this.metrics.successCount > 0 ? 
      this.metrics.totalTime / this.metrics.successCount : 0;
    
    return {
      requestCount: totalRequests,
      successCount: this.metrics.successCount,
      failureCount: this.metrics.failureCount,
      successRate: successRate,
      averageRequestTime: avgRequestTime
    };
  }
  
  // Create drug cards HTML from the drug list
  createDrugCards(drugs) {
    if (!drugs || drugs.length === 0) {
      return '<div class="no-drugs">No drugs found for this gene.</div>';
    }
    
    // Sort drugs by repurposing score (highest first)
    const sortedDrugs = [...drugs].sort((a, b) => {
      // If repurposing score exists for both, compare them
      if (a.repurposingScore !== undefined && b.repurposingScore !== undefined) {
        return b.repurposingScore - a.repurposingScore;
      }
      // If only one has a score, prioritize it
      if (a.repurposingScore !== undefined) return -1;
      if (b.repurposingScore !== undefined) return 1;
      // If neither has a score, sort alphabetically
      return a.name.localeCompare(b.name);
    });
    
    let html = '<div class="drug-cards-container">';
    
    sortedDrugs.forEach(drug => {
      const hasScore = drug.repurposingScore !== undefined;
      const scoreClass = hasScore ? 
        (drug.repurposingScore > 0.7 ? 'high-score' : 
         drug.repurposingScore > 0.4 ? 'medium-score' : 'low-score') : '';
      
      html += `
        <div class="drug-card ${scoreClass}">
          <h3 class="drug-name">${drug.name}</h3>
          ${drug.description ? `<p class="drug-description">${drug.description}</p>` : ''}
          ${hasScore ? `
            <div class="repurposing-score-container">
              <div class="repurposing-score-label">Repurposing Score:</div>
              <div class="repurposing-score-value">${(drug.repurposingScore * 100).toFixed(1)}%</div>
            </div>
          ` : ''}
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }
  
  // Process a gene to find related genes and drugs
  async processGene(geneId) {
    try {
      debug(`Processing gene: ${geneId}`);
      // Get related genes and drugs
      const result = await this.getRelatedGenesAndDrugs(geneId);
      
      if (result.error) {
        console.error("Error processing gene:", result.error);
        throw new Error(result.message || result.error);
      }
      
      // Extract data from result
      const { geneName, diseases, drugsWithInfo, relatedGenes } = result;
      
      // Create gene info object
      const geneInfo = {
        id: geneId,
        name: geneName,
        description: `${diseases?.length || 0} associated diseases`
      };
      
      // Display the gene info
      this.displayGeneInfo(geneInfo);
      
      // Extract related genes data for visualization
      const relatedGenesArray = [];
      for (const [geneId, geneData] of Object.entries(relatedGenes)) {
        relatedGenesArray.push({
          id: geneId,
          name: geneData.geneName,
          description: geneData.relation || "Related Gene"
        });
      }
      
      // Create the network visualization
      this.createNetworkVisualization(geneId, relatedGenesArray);
      
      // Collect all drugs from the base gene and related genes
      let allDrugs = [...(drugsWithInfo || [])];
      
      // Add drugs from related genes
      for (const geneData of Object.values(relatedGenes)) {
        if (geneData.drugsWithInfo && geneData.drugsWithInfo.length > 0) {
          allDrugs = [...allDrugs, ...geneData.drugsWithInfo];
        }
      }
      
      // Remove duplicates (by drug code)
      const uniqueDrugs = [];
      const seenDrugCodes = new Set();
      
      for (const drug of allDrugs) {
        if (!seenDrugCodes.has(drug.code)) {
          seenDrugCodes.add(drug.code);
          uniqueDrugs.push(drug);
        }
      }
      
      debug(`Displaying ${uniqueDrugs.length} unique drugs`);
      
      // Display drug cards
      this.displayDrugCards(uniqueDrugs);
      
      return result;
    } catch (error) {
      console.error("Error processing gene:", error);
      throw error;
    }
  }
  
  // Display gene information
  displayGeneInfo(geneInfo) {
    const geneInfoElement = document.getElementById('gene-info');
    if (!geneInfoElement) return;
    
    geneInfoElement.innerHTML = `
      <h2>Gene: ${geneInfo.name || geneInfo.id}</h2>
      ${geneInfo.description ? `<p>${geneInfo.description}</p>` : ''}
      ${geneInfo.pathway ? `<p><strong>Pathway:</strong> ${geneInfo.pathway}</p>` : ''}
      <p><strong>ID:</strong> ${geneInfo.id}</p>
    `;
  }
  
  // Display drug cards
  displayDrugCards(drugs) {
    const drugCardsElement = document.getElementById('drug-cards');
    if (!drugCardsElement) return;
    
    drugCardsElement.innerHTML = `
      <h2>Related Drugs</h2>
      ${this.createDrugCards(drugs)}
    `;
  }
  
  // Create a network visualization for the gene and its relations
  createNetworkVisualization(centralGeneId, relatedGenes) {
    const graphElement = document.getElementById('graph');
    if (!graphElement) return;
    
    // Clear previous graph
    graphElement.innerHTML = '';
    
    // Create SVG
    const width = graphElement.clientWidth || 800;
    const height = graphElement.clientHeight || 600;
    
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    graphElement.appendChild(svg);
    
    // Create nodes data
    const nodes = [
        { id: centralGeneId, name: this.formatGeneId(centralGeneId), type: 'central' },
        ...relatedGenes.map(gene => ({
            id: gene.id,
            name: this.formatGeneId(gene.id),
            type: 'related',
            description: gene.description || ''
        }))
    ];
    
    // Create a simple force-directed layout
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.4;
    
    // Position central gene in the middle
    const centralNode = nodes[0];
    centralNode.x = centerX;
    centralNode.y = centerY;
    
    // Position related genes in a circle around the central gene
    const relatedNodes = nodes.slice(1);
    const angleStep = (2 * Math.PI) / relatedNodes.length;
    
    relatedNodes.forEach((node, i) => {
        const angle = i * angleStep;
        node.x = centerX + radius * Math.cos(angle);
        node.y = centerY + radius * Math.sin(angle);
    });
    
    // Draw edges
    relatedNodes.forEach(node => {
        const edge = document.createElementNS("http://www.w3.org/2000/svg", "line");
        edge.setAttribute("x1", centralNode.x);
        edge.setAttribute("y1", centralNode.y);
        edge.setAttribute("x2", node.x);
        edge.setAttribute("y2", node.y);
        edge.setAttribute("stroke", "#aaa");
        edge.setAttribute("stroke-width", "1");
        svg.appendChild(edge);
    });
    
    // Draw nodes
    nodes.forEach(node => {
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("transform", `translate(${node.x},${node.y})`);
        
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", node.type === 'central' ? 20 : 15);
        circle.setAttribute("fill", node.type === 'central' ? "#4CAF50" : "#2196F3");
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dy", "0.3em");
        text.setAttribute("fill", "white");
        text.setAttribute("font-size", "10");
        text.textContent = node.name;
        
        group.appendChild(circle);
        group.appendChild(text);
        
        // Add tooltip on hover
        group.addEventListener('mouseenter', (event) => {
            const tooltip = document.getElementById('tooltip');
            if (tooltip) {
                tooltip.innerHTML = `
                    <div><strong>${node.name}</strong></div>
                    ${node.description ? `<div>${node.description}</div>` : ''}
                `;
                tooltip.style.display = 'block';
                tooltip.style.left = `${event.pageX + 10}px`;
                tooltip.style.top = `${event.pageY + 10}px`;
            }
        });
        
        group.addEventListener('mouseleave', () => {
            const tooltip = document.getElementById('tooltip');
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        });
        
        svg.appendChild(group);
    });
  }
  
  // Format gene ID for display (remove 'hsa:' prefix)
  formatGeneId(id) {
    return id.replace('hsa:', '');
  }
}

// Drug Finder class for displaying drug information
class DrugFinder {
  constructor(results) {
    this.results = results;
  }

  showBaseDrugs() {
    const resultContainer = document.getElementById('drug-results');
    const drugsContainer = document.createElement('div');
    drugsContainer.className = 'gene-drugs';
    
    if (!this.results || !this.results.drugsWithInfo || this.results.drugsWithInfo.length === 0) {
      drugsContainer.innerHTML = `
        <h3>Direct Drug Associations for ${this.results?.geneName || 'Unknown Gene'}</h3>
        <p class="no-results">No directly associated drugs found for this gene.</p>
      `;
      resultContainer.appendChild(drugsContainer);
      return;
    }
    
    drugsContainer.innerHTML = `
      <h3>Direct Drug Associations for ${this.results.geneName}</h3>
      <div class="drugs-grid">
        ${this.results.drugsWithInfo.map(drug => {
          // Determine score class based on value
          const hasScore = drug.repurposingScore !== undefined;
          const scoreClass = hasScore ? 
            (drug.repurposingScore > 0.7 ? 'high-score' :
             drug.repurposingScore > 0.4 ? 'medium-score' : 'low-score') : '';
          
          return `
            <div class="drug-card ${scoreClass}">
              <div class="drug-name">${drug.name} (${drug.code})</div>
              ${drug.diseases && drug.diseases.length > 0 ? `
                <div class="drug-diseases">
                  <strong>Associated Diseases:</strong>
                  <ul class="diseases-list">
                    ${drug.diseases.map(disease => 
                      `<li class="disease-item">${disease.name} (${disease.code})</li>`
                    ).join('')}
                  </ul>
                </div>
              ` : '<div class="drug-diseases">No associated diseases</div>'}
              <div class="repurposing-score-container">
                <div class="repurposing-score-label">Repurposing Score:</div>
                <div class="repurposing-score-value">${(drug.repurposingScore * 100).toFixed(1)}%</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    
    resultContainer.appendChild(drugsContainer);
  }

  showRelatedDrugs() {
    const resultContainer = document.getElementById('drug-results');
    
    if (!this.results || !this.results.relatedGenes || Object.keys(this.results.relatedGenes).length === 0) {
      const noResultsElem = document.createElement('div');
      noResultsElem.className = 'no-related-genes';
      noResultsElem.innerHTML = `<p>No related genes found to analyze for drug interactions.</p>`;
      resultContainer.appendChild(noResultsElem);
      return;
    }
    
    for (const [geneCode, geneInfo] of Object.entries(this.results.relatedGenes)) {
      // Skip if no drugs for this gene
      if (!geneInfo.drugsWithInfo || geneInfo.drugsWithInfo.length === 0) continue;
      
      const geneContainer = document.createElement('div');
      geneContainer.className = 'related-gene-drugs';
      
      geneContainer.innerHTML = `
        <h3>Related Gene: ${geneInfo.name} (${geneCode})</h3>
        <div class="relation-info">Relation: ${geneInfo.relation || 'Pathway'}</div>
        <div class="drugs-grid">
          ${geneInfo.drugsWithInfo.map(drug => {
            // Determine score class based on value
            const hasScore = drug.repurposingScore !== undefined;
            const scoreClass = hasScore ? 
              (drug.repurposingScore > 0.7 ? 'high-score' :
               drug.repurposingScore > 0.4 ? 'medium-score' : 'low-score') : '';
            
            return `
              <div class="drug-card ${scoreClass}">
                <div class="drug-name">${drug.name} (${drug.code})</div>
                ${drug.diseases && drug.diseases.length > 0 ? `
                  <div class="drug-diseases">
                    <strong>Associated Diseases:</strong>
                    <ul class="diseases-list">
                      ${drug.diseases.map(disease => 
                        `<li class="disease-item">${disease.name} (${disease.code})</li>`
                      ).join('')}
                    </ul>
                  </div>
                ` : '<div class="drug-diseases">No associated diseases</div>'}
                <div class="repurposing-score-container">
                  <div class="repurposing-score-label">Repurposing Score:</div>
                  <div class="repurposing-score-value">${(drug.repurposingScore * 100).toFixed(1)}%</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      
      resultContainer.appendChild(geneContainer);
    }
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize API
    const keggApi = new KeggAPI();
    
    // DOM elements
    const geneInput = document.getElementById('gene-input');
    const resultsContainer = document.getElementById('results');
    const loadingIndicator = document.getElementById('spinner');
    const messageElement = document.getElementById('message');
    const metricsElement = document.getElementById('api-metrics');
    const debugBtn = document.getElementById('debug-btn');
    const debugOutput = document.getElementById('debug-output');
    const clearCacheBtn = document.getElementById('clear-cache');
    
    if (clearCacheBtn) clearCacheBtn.remove();
    
    let isProcessing = false;
    
    // Show initial message
    showMessage("Search for a gene by its KEGG ID to find related drugs and pathways.", "info");
    
    // Toggle debug mode
    if (debugBtn) {
      debugBtn.addEventListener('click', () => {
        CONFIG.DEBUG_MODE = !CONFIG.DEBUG_MODE;
        debugBtn.textContent = CONFIG.DEBUG_MODE ? 'Disable Debug' : 'Enable Debug';
        debugOutput.style.display = CONFIG.DEBUG_MODE ? 'block' : 'none';
        showMessage(`Debug mode ${CONFIG.DEBUG_MODE ? 'enabled' : 'disabled'}`, 'info');
      });
    }
    
    // Update metrics periodically
    setInterval(updateMetrics, 10000);
    setTimeout(updateMetrics, 3000);
    
    function updateMetrics() {
      try {
        const metrics = keggApi.getPerformanceMetrics();
        metricsElement.innerHTML = `
          <strong>API Status:</strong> ${metrics.successRate.toFixed(1)}% success rate | 
          ${metrics.requestCount} requests (${metrics.successCount} success, ${metrics.failureCount} failed) | 
          Avg response: ${metrics.averageRequestTime.toFixed(0)}ms
        `;
      } catch (error) {
        debug('Error updating metrics:', error);
      }
    }
    
    // Show message to user
    function showMessage(message, type = 'info') {
      messageElement.textContent = message;
      messageElement.className = `message ${type}`;
      messageElement.style.display = 'block';
      
      if (type === 'info') {
        setTimeout(() => {
          messageElement.style.display = 'none';
        }, 10000);
      }
    }
    
    // Handle form submission
    const geneForm = document.getElementById('gene-form');
    if (geneForm) {
      geneForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (isProcessing) {
          showMessage('A request is already in progress. Please wait.', 'info');
          return;
        }
        
        const geneCode = geneInput.value.trim();
        
    if (!geneCode) {
          showMessage('Please enter a gene code (e.g., hsa:5747)', 'error');
      return;
    }
    
        isProcessing = true;
        loadingIndicator.style.display = 'block';
        resultsContainer.innerHTML = '';
        messageElement.style.display = 'none';
        
        window.updateProgress?.(10, 'Searching for gene...');
        
        try {
          // Process the gene
          const results = await keggApi.getRelatedGenesAndDrugs(geneCode);
          
          window.updateProgress?.(100, 'Search complete');
          
          if (results.error) {
            showMessage(`Error: ${results.message || results.error}`, 'error');
            window.showError?.(results.error, results.message);
        return;
      }
      
          displayResults(results, geneCode);
          showMessage(`Successfully retrieved data for ${geneCode}`, 'success');
    } catch (error) {
          showMessage(`Error processing gene: ${error.message}`, 'error');
          window.showError?.('Processing Error', error.message);
          debug('Error:', error);
        } finally {
          loadingIndicator.style.display = 'none';
          isProcessing = false;
          updateMetrics();
          window.updateProgress?.(-1);
        }
      });
    }
    
    // Retry button handler
    const retryButton = document.getElementById('retry-button');
    if (retryButton) {
      retryButton.addEventListener('click', function() {
        retryButton.style.display = 'none';
        if (geneForm) geneForm.dispatchEvent(new Event('submit'));
      });
    }
    
    // Display results on the page
    function displayResults(data, geneCode) {
      if (!resultsContainer) return;
    
    // Clear previous results and create a container for the drug results 
      resultsContainer.innerHTML = '';
      const drugResults = document.createElement('div');
      drugResults.id = 'drug-results';
      
      // Create header
      const header = document.createElement('h2');
      header.textContent = `Results for ${data.geneName} (${geneCode})`;
      resultsContainer.appendChild(header);
      
      // Create main sections
      const mainGeneSection = document.createElement('div');
      mainGeneSection.className = 'base-gene';
      
      // Main gene information
      const mainGeneHeader = document.createElement('h3');
      mainGeneHeader.textContent = 'Base Gene Information:';
      mainGeneSection.appendChild(mainGeneHeader);
      
      // Display KO information for the base gene if available
      if (data.geneKO && data.geneKO.length > 0) {
      const koHeader = document.createElement('p');
      koHeader.className = 'ko-header';
        koHeader.textContent = `KEGG Orthology:`;
        mainGeneSection.appendChild(koHeader);
      
      const koList = document.createElement('ul');
      koList.className = 'ko-list';
      
        data.geneKO.forEach(ko => {
        const koItem = document.createElement('li');
          koItem.textContent = `${ko.name} (${ko.id})`;
        koList.appendChild(koItem);
      });
      
        mainGeneSection.appendChild(koList);
      }
      
      // Display diseases associated with the base gene
      if (data.diseases && data.diseases.length > 0) {
        const diseasesHeader = document.createElement('p');
          diseasesHeader.className = 'diseases-header';
        diseasesHeader.textContent = 'Associated diseases:';
        mainGeneSection.appendChild(diseasesHeader);
          
          const diseasesList = document.createElement('ul');
          diseasesList.className = 'diseases-list';
          
        data.diseases.forEach(disease => {
            const diseaseItem = document.createElement('li');
            diseaseItem.className = 'disease-item';
            diseaseItem.textContent = `${disease.name} (${disease.code})`;
            diseasesList.appendChild(diseaseItem);
          });
          
        mainGeneSection.appendChild(diseasesList);
      }

      // Add the main gene section to the results container
      resultsContainer.appendChild(mainGeneSection);
      
      // Add the drug results container
      resultsContainer.appendChild(drugResults);
      
      // Set up the finder to display drugs
      const finder = new DrugFinder(data);
      finder.showBaseDrugs();
      finder.showRelatedDrugs();
    }
      
      // Expose keggApi for debugging
      window.keggApi = keggApi;
      
      // Log readiness
      debug('KEGG Gene and Drug Finder application initialized');
    } catch (error) {
      console.error('Error initializing application:', error);
      const messageElement = document.getElementById('message');
      if (messageElement) {
        messageElement.textContent = `Error initializing application: ${error.message}`;
        messageElement.className = 'message error';
        messageElement.style.display = 'block';
      }
    }
  });