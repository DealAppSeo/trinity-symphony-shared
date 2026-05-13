require('dotenv').config();
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

// Config
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const PRIVATE_KEY = process.env.TRINITY_DEPLOYER_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qnnpjhlxljtqyigedwkb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONTRACT_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e'; // Deployed contract
const CHAIN_ID = 84532;
const DRY_RUN = process.env.DRY_RUN === 'true';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ABI = [
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

async function main() {
  console.log(`🚀 Starting Mint Script (Dry Run: ${DRY_RUN})`);
  
  if (!PRIVATE_KEY) throw new Error("Missing TRINITY_DEPLOYER_PRIVATE_KEY");
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  // Pre-flight checks
  const balance = await provider.getBalance(signer.address);
  console.log(`Wallet: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance < ethers.parseEther("0.001")) {
    throw new Error("Insufficient balance (< 0.001 ETH)");
  }

  const agentsToMint = ['trinity-shofet', 'trinity-veritas'];

  for (const agentName of agentsToMint) {
    console.log(`\n--- Processing ${agentName} ---`);
    
    // 1. Check DB for existing mint
    const { data: agentData, error: dbError } = await supabase
      .from('repid_agents')
      .select('id, agent_name, tier, current_repid, squad_role, erc8004_token_id, mint_tx_hash')
      .eq('agent_name', agentName)
      .single();
      
    if (dbError) {
      console.error(`❌ DB Error for ${agentName}:`, dbError.message);
      continue;
    }
    
    if (!agentData) {
      console.error(`❌ Agent ${agentName} not found in repid_agents`);
      continue;
    }
    
    if (agentData.mint_tx_hash || agentData.erc8004_token_id) {
      console.log(`✅ ${agentName} is already minted (Token ID: ${agentData.erc8004_token_id}, TX: ${agentData.mint_tx_hash})`);
      continue;
    }

    const metadataUri = `https://repid.dev/agents/${agentData.id}/metadata`;
    console.log(`Metadata URI: ${metadataUri}`);

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would call register("${metadataUri}")`);
      console.log(`[DRY-RUN] Would update repid_agents and agent_a2a_cards for ${agentName}`);
      continue;
    }

    try {
      console.log(`⏳ Submitting transaction...`);
      const tx = await contract.register(metadataUri);
      console.log(`✅ Tx Submitted: ${tx.hash}`);
      
      const receipt = await tx.wait(1);
      console.log(`✅ Tx Confirmed in Block ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed.toString()})`);
      
      // Extract Token ID
      let tokenId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === 'Registered') {
            tokenId = parsed.args.agentId.toString();
            break;
          } else if (parsed && parsed.name === 'Transfer' && parsed.args.from === ethers.ZeroAddress) {
            tokenId = parsed.args.tokenId.toString();
          }
        } catch (e) {
          // Ignore logs that can't be parsed
        }
      }
      
      if (!tokenId) {
        throw new Error("Could not extract token ID from transaction receipt");
      }
      console.log(`🎉 Minted Token ID: ${tokenId}`);

      // Update repid_agents
      const { error: updateError } = await supabase
        .from('repid_agents')
        .update({
          mint_tx_hash: tx.hash,
          mint_block_number: receipt.blockNumber,
          minted_at: new Date().toISOString(),
          mint_chain_id: CHAIN_ID,
          erc8004_token_id: tokenId,
          erc8004_address: ethers.Wallet.createRandom().address, // Placeholder until TBA is deployed
          conservator_address: signer.address
        })
        .eq('id', agentData.id);
        
      if (updateError) throw new Error(`Failed to update repid_agents: ${updateError.message}`);
      
      // Insert into agent_a2a_cards
      const cardPayload = {
        name: agentName.replace('trinity-', '').toUpperCase(),
        tier: agentData.tier || "UNKNOWN",
        repid: agentData.current_repid || 0,
        skills: ["constitutional-veto", "a2a-messaging", "mcp-routing"],
        erc8004: {
          network: "base-sepolia",
          tokenId: tokenId
        }
      };
      
      const { error: insertError } = await supabase
        .from('agent_a2a_cards')
        .insert({
          agent_name: cardPayload.name,
          token_id: tokenId,
          agent_card: cardPayload
        });
        
      if (insertError) throw new Error(`Failed to insert to agent_a2a_cards: ${insertError.message}`);
      
      console.log(`💾 Database records updated successfully for ${agentName}.`);
      
    } catch (e) {
      console.error(`❌ Minting failed for ${agentName}:`, e.message);
    }
  }
}

main().catch(console.error);
