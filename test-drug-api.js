// Test script to fetch drug information from KEGG API
async function testDrugApi() {
  const drugCodes = ['D00036', 'D00049', 'D00097']; // Some sample drug codes
  
  console.log('Testing KEGG Drug API...');
  
  for (const code of drugCodes) {
    const formattedCode = `dr:${code}`;
    const url = `https://rest.kegg.jp/get/${formattedCode}`;
    console.log(`Fetching ${url}...`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain'
        }
      });
      
      if (!response.ok) {
        console.error(`Error: ${response.status} ${response.statusText}`);
        continue;
      }
      
      const data = await response.text();
      console.log(`Response length: ${data.length} characters`);
      
      // Check for DISEASE section
      const diseaseIndex = data.indexOf('DISEASE');
      if (diseaseIndex >= 0) {
        console.log(`DISEASE section found at position ${diseaseIndex}`);
        
        // Display a snippet of the DISEASE section
        const diseaseSection = data.substring(diseaseIndex, diseaseIndex + 300);
        console.log('DISEASE section snippet:');
        console.log(diseaseSection);
        
        // Try different regex patterns
        const patterns = [
          /DISEASE\s+(.*?)(?=\n[A-Z]|\n\n|$)/gs, // Original pattern
          /DISEASE\s+([\s\S]*?)(?=\n\S+:|$)/, // New pattern from our last fix
          /\[DS:(.*?)\]\s+(.*?)(?:\s+\(.*\))?$/gm, // Disease code pattern
        ];
        
        for (let i = 0; i < patterns.length; i++) {
          const matches = data.match(patterns[i]);
          console.log(`Pattern ${i+1} matches: ${matches ? matches.length : 0}`);
          if (matches && matches.length > 0) {
            console.log(`First match: ${matches[0].substring(0, 100)}...`);
          }
        }
      } else {
        console.log('No DISEASE section found in the response');
      }
      
      console.log('---------------------------');
    } catch (error) {
      console.error(`Error fetching drug ${code}: ${error.message}`);
    }
  }
  
  console.log('Test completed');
}

// Execute the test
testDrugApi(); 