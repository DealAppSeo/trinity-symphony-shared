function provenance(tier, source, overrides = {}) {
  const isInternal = tier.startsWith('T0') || tier.startsWith('T1') || tier.startsWith('T2');
  return {
    test_tier: tier,
    test_source: source,
    external_party_id: isInternal ? null : (overrides.external_party_id ?? null),
    external_party_aware: isInternal ? null : (overrides.external_party_aware ?? null),
    adversarial_planted: tier === 'T2b_INTERNAL_REAL_ADVERSARIAL' || (overrides.adversarial_planted ?? false),
    brain_provenance: overrides.brain_provenance ?? [],
    patent_eligible: overrides.patent_eligible ?? (tier !== 'T0_INTERNAL_DEV_TEST' && tier !== 'T1_INTERNAL_SIMULATION'),
    patent_classes: overrides.patent_classes ?? [],
    provenance_notes: overrides.provenance_notes ?? '',
    provenance_tagged_at: new Date().toISOString()
  };
}

function inheritProvenance(parentMetadata, source) {
  const parentTier = parentMetadata?.test_tier;
  if (!parentTier) {
    return { test_tier: 'T0_INTERNAL_DEV_TEST', test_source: source };
  }
  return {
    test_tier: parentTier,
    test_source: source,
    inherited_from: parentMetadata.test_source,
    patent_eligible: parentMetadata.patent_eligible,
    patent_classes: parentMetadata.patent_classes,
    provenance_tagged_at: new Date().toISOString()
  };
}

module.exports = { provenance, inheritProvenance };
