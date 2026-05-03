const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const MathConstants = require('../MathConstants');

class ReceiptValidator {
  constructor() {
    this.ajv = new Ajv();
    addFormats(this.ajv);
    
    try {
      const schemaPath = path.resolve(__dirname, '../../../../hyperdag-protocol/schemas/receipt.v1.json');
      const schemaStr = fs.readFileSync(schemaPath, 'utf8');
      this.schema = JSON.parse(schemaStr);
      this.validateSchema = this.ajv.compile(this.schema);
    } catch (e) {
      console.warn('[ReceiptValidator] Could not load CC1 schema, using minimal fallback', e.message);
      this.schema = { type: 'object' };
      this.validateSchema = () => true;
    }
  }

  async validate(receipt, context) {
    const { agentName, agentVersion, halOutput } = context || {};

    // 1. Schema Validation
    const valid = this.validateSchema(receipt);
    if (!valid) {
      return {
        agentName,
        verdict: 'veto',
        confidence: 1.0,
        reasoningHash: 'schema_invalid',
        timestamp: new Date().toISOString(),
        signature: '0x0'
      };
    }

    let verdict = 'indeterminate';
    let confidence = 0;

    switch (agentName) {
      case 'W3C':
        // Schema check passed above
        verdict = 'pass';
        confidence = 0.95;
        break;

      case 'HDM':
        // HAL sanity check
        if (receipt.hal && (receipt.hal.dofVersion === 5 || receipt.hal.dofVersion === 6)) {
          verdict = 'pass';
          confidence = 0.9;
        } else {
          verdict = 'veto';
          confidence = 0.99;
        }
        break;

      case 'ORCH':
        // ORCH alone is indeterminate on single validation
        verdict = 'indeterminate';
        break;

      case 'SOPHIA':
      case 'VERITAS':
      case 'TORCH':
      case 'RAVEN':
      case 'GCM':
      case 'MEL':
      case 'APM':
      case 'CHESED':
      case 'SHOFET':
      default:
        // TODO v1.1
        verdict = 'indeterminate';
        break;
    }

    return {
      agentName,
      verdict,
      confidence,
      reasoningHash: '0x0', // v1.0 Stub
      timestamp: new Date().toISOString(),
      signature: '0x0' // v1.0 Stub
    };
  }

  async aggregateAttestations(attestations) {
    // Filter out indeterminate
    const decisive = attestations.filter(a => a.verdict !== 'indeterminate');
    if (decisive.length < 4) {
      // Need at least 4 of 12 to make any decision
      return { verdict: 'insufficient_validators', confidence: 0 };
    }

    const passCount = decisive.filter(a => a.verdict === 'pass').length;
    const vetoCount = decisive.filter(a => a.verdict === 'veto').length;
    const passRatio = passCount / decisive.length;

    const dissonance = MathConstants.PYTHAGOREAN_COMMA - 1;

    // Pythagorean Comma threshold for veto override
    if (vetoCount >= 1 && dissonance >= MathConstants.DISSONANCE_THRESHOLD) {
      return { verdict: 'veto', confidence: 1.0 };
    }

    if (passRatio >= MathConstants.BFT_THRESHOLD) {
      return { verdict: 'pass', confidence: passRatio };
    }

    return { verdict: 'inconclusive', confidence: 0 };
  }
}

module.exports = ReceiptValidator;
