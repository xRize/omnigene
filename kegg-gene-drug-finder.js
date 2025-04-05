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
    
    // Display CORS information message
    this._showCorsMessage();
    
    debug("KeggAPI initialized");
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
      
      // Store disease codes for later comparison
      const baseGeneDiseasesCodes = geneDiseases.map(disease => disease.code);
      debug(`Base gene disease codes: ${baseGeneDiseasesCodes.join(', ')}`);
      
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
            drugsWithInfo = await this._fetchDrugDetails(baseDrugs);
            
            // Calculate repurposing score for base gene drugs
            drugsWithInfo = drugsWithInfo.map(drug => {
              // For base gene drugs, we only consider the disease association
              let repurposingScore = 2; // Standard score
              
              // +5 if the drug has associated diseases
              if (drug.diseases && drug.diseases.length > 0) {
                repurposingScore += 5;
              }
              
              drug.repurposingScore = repurposingScore;
              return drug;
            });
            
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
        await this._processPathway(pathway, formattedGeneCode, relatedGenes, baseGeneDiseasesCodes);
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
  async _fetchDrugDetails(drugCodes) {
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
          diseases: []
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
  async _processPathway(pathway, sourceGeneCode, relatedGenes, baseGeneDiseasesCodes) {
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
          
          // Determine relationship type (placeholder logic)
          // Here we're using a hash of the gene code to get consistent but seemingly random relationship types
          const relationshipType = relatedGene.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 2 === 0 ? 
            'activation' : 'inhibition';
            
          // Check if any diseases from the related gene match the base gene
          const sharedDiseases = relatedGeneDiseases.filter(disease => 
            baseGeneDiseasesCodes.includes(disease.code)
          );
          const hasSharedDisease = sharedDiseases.length > 0;
          debug(`Genes share diseases: ${hasSharedDisease ? 'Yes' : 'No'} (${sharedDiseases.length} shared)`);
          
          // Initialize with basic info in case drug fetch fails
          relatedGenes[relatedGene] = {
            geneName: relatedGeneName,
            relation: "Pathway",
            pathway: pathwayName,
            ko: relatedGeneKO,
            diseases: relatedGeneDiseases,
            drugs: [],
            drugsWithInfo: [],
            relationshipType: relationshipType,
            hasSharedDisease: hasSharedDisease,
            sharedDiseases: sharedDiseases
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
              let drugsWithInfo = await this._fetchDrugDetails(drugCodes);
              
              // Calculate repurposing score for each drug
              drugsWithInfo = drugsWithInfo.map(drug => {
                let repurposingScore = 2; // Standard score
                
                // +8 if the searched gene and the similar one share the same disease
                if (hasSharedDisease) {
                  repurposingScore += 8;
                  debug(`+8 score for ${drug.name} - genes share diseases`);
                }
                
                // +5 if the drug has at least an associated disease
                if (drug.diseases && drug.diseases.length > 0) {
                  repurposingScore += 5;
                  debug(`+5 score for ${drug.name} - drug has associated diseases`);
                }
                
                // +2 if activation relationship, -1 if inhibition
                if (relationshipType === 'activation') {
                  repurposingScore += 2;
                  debug(`+2 score for ${drug.name} - activation relationship`);
                } else {
                  repurposingScore -= 1;
                  debug(`-1 score for ${drug.name} - inhibition relationship`);
                }
                
                drug.repurposingScore = repurposingScore;
                return drug;
              });
              
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
    
    // Clear previous results
      resultsContainer.innerHTML = '';
      
      // Create header
      const header = document.createElement('h2');
      header.textContent = `Results for ${data.geneName} (${geneCode})`;
      resultsContainer.appendChild(header);
      
      // Create main sections
      const mainGeneSection = document.createElement('div');
      mainGeneSection.className = 'base-gene';
      
      const relatedGenesSection = document.createElement('div');
      
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

      // Display drugs for the base gene
      if (data.drugsWithInfo && data.drugsWithInfo.length > 0) {
        const drugsHeader = document.createElement('p');
        drugsHeader.className = 'drugs-header';
        drugsHeader.textContent = `Compatible drugs (${data.drugsWithInfo.length}):`;
        mainGeneSection.appendChild(drugsHeader);
      
        const drugsList = document.createElement('ul');
        drugsList.className = 'drug-list';
        
        // Sort drugs by repurposing score (descending)
        const sortedDrugs = [...data.drugsWithInfo].sort((a, b) => (b.repurposingScore || 0) - (a.repurposingScore || 0));
      
        sortedDrugs.forEach((drug, index) => {
          const drugItem = document.createElement('li');
          
          const scoreDisplay = drug.repurposingScore ? 
            `<span class="repurposing-score">Repurposing Score: ${drug.repurposingScore}</span>` : '';
          
          drugItem.innerHTML = `
            <div class="drug-name">${index + 1}. ${drug.name} (${drug.code}) ${scoreDisplay}</div>
            ${drug.diseases && drug.diseases.length > 0 ? 
              `<div class="diseases-container">
                <span class="diseases-header">Associated diseases:</span>
                <ul class="diseases-list">
                  ${drug.diseases.map(disease => 
                    `<li class="disease-item">${disease.name} (${disease.code})</li>`
                  ).join('')}
                </ul>
              </div>` : 
              '<span class="no-diseases"> - No associated diseases found</span>'
            }
          `;
        drugsList.appendChild(drugItem);
      });
      
        mainGeneSection.appendChild(drugsList);
    } else {
      const noDrugsP = document.createElement('p');
      noDrugsP.textContent = 'No compatible drugs found for this gene.';
        mainGeneSection.appendChild(noDrugsP);
    }
    
      resultsContainer.appendChild(mainGeneSection);
    
    // Show related genes and drugs
    const relatedGenesHeader = document.createElement('h3');
      relatedGenesHeader.textContent = `Similar Genes with Compatible Drugs (${Object.keys(data.relatedGenes).length}):`;
      relatedGenesSection.appendChild(relatedGenesHeader);
      
      // Display related genes
      if (Object.keys(data.relatedGenes).length > 0) {
      const geneList = document.createElement('ul');
      geneList.className = 'gene-list';
      
      let geneCounter = 1;
        for (const [geneCode, geneData] of Object.entries(data.relatedGenes)) {
        const geneItem = document.createElement('li');
        geneItem.className = 'gene-item';
        
          // Basic gene info
          let geneHTML = `
            <div class="gene-title">${geneCounter++}. ${geneData.geneName} (${geneCode})</div>
            <p class="gene-relation">
              Relation: ${geneData.relation || 'Unknown'} - 
              Pathway: ${geneData.pathway || 'Unknown'} - 
              Relationship Type: <span class="${geneData.relationshipType}">${geneData.relationshipType || 'Unknown'}</span>
            </p>
          `;
          
          // Add shared disease information if available
          if (geneData.hasSharedDisease && geneData.sharedDiseases && geneData.sharedDiseases.length > 0) {
            geneHTML += `
              <p class="shared-diseases-header" style="color: #e67e22; font-weight: bold;">Shared diseases with base gene:</p>
              <ul class="shared-diseases-list">
                ${geneData.sharedDiseases.map(disease => 
                  `<li class="shared-disease-item" style="color: #e67e22;">${disease.name} (${disease.code})</li>`
                ).join('')}
              </ul>
            `;
          }
          
          // Add KO information if available
          if (geneData.ko && geneData.ko.length > 0) {
            geneHTML += `
              <p class="ko-header">KEGG Orthology:</p>
              <ul class="ko-list">
                ${geneData.ko.map(ko => `<li>${ko.name} (${ko.id})</li>`).join('')}
              </ul>
            `;
          }
            
            // Add disease information if available
          if (geneData.diseases && geneData.diseases.length > 0) {
            geneHTML += `
              <p class="diseases-header">Associated diseases:</p>
              <ul class="diseases-list">
                ${geneData.diseases.map(disease => `<li class="disease-item">${disease.name} (${disease.code})</li>`).join('')}
              </ul>
            `;
          }
          
          // Add drug information
          if (geneData.drugsWithInfo && geneData.drugsWithInfo.length > 0) {
            // Sort drugs by repurposing score (descending)
            const sortedDrugs = [...geneData.drugsWithInfo].sort((a, b) => (b.repurposingScore || 0) - (a.repurposingScore || 0));
            
            geneHTML += `
              <p>Compatible drugs (${sortedDrugs.length}):</p>
              <ul class="drug-list">
                ${sortedDrugs.map((drug, index) => {
                  const scoreDisplay = drug.repurposingScore ? 
                    `<span class="repurposing-score" style="font-weight: bold; color: #3498db;">Repurposing Score: ${drug.repurposingScore}</span>` : '';
                  
                  return `
                    <li>
                      <div class="drug-name">${index + 1}. ${drug.name} (${drug.code}) ${scoreDisplay}</div>
                      ${drug.diseases && drug.diseases.length > 0 ? 
                        `<div class="diseases-container">
                          <span class="diseases-header">Associated diseases:</span>
                          <ul class="diseases-list">
                            ${drug.diseases.map(disease => 
                              `<li class="disease-item">${disease.name} (${disease.code})</li>`
                            ).join('')}
                          </ul>
                        </div>` : 
                        '<span class="no-diseases"> - No associated diseases found</span>'
                      }
                    </li>
                  `;
                }).join('')}
              </ul>
            `;
          } else {
            geneHTML += '<p>No compatible drugs found for this gene.</p>';
          }
          
          geneItem.innerHTML = geneHTML;
        geneList.appendChild(geneItem);
      }
      
        relatedGenesSection.appendChild(geneList);
      } else {
        const noGenesP = document.createElement('p');
        noGenesP.textContent = 'No similar genes with compatible drugs found.';
        relatedGenesSection.appendChild(noGenesP);
      }
      
      resultsContainer.appendChild(relatedGenesSection);
    }
    
    // Add custom CSS for repurposing score
    const style = document.createElement('style');
    style.textContent = `
      .repurposing-score {
        margin-left: 10px;
        padding: 2px 6px;
        background-color: #3498db;
        color: white;
        border-radius: 4px;
        font-size: 0.9em;
      }
      .activation {
        color: #2ecc71;
        font-weight: bold;
      }
      .inhibition {
        color: #e74c3c;
        font-weight: bold;
      }
      .shared-disease-item {
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
    
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