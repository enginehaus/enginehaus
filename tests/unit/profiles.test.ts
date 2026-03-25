import { describe, it, expect } from 'vitest';
import { profilePhasesToDefinitions } from '../../src/profiles/types.js';
import { loadProfile, listProfiles } from '../../src/profiles/loader.js';

describe('profilePhasesToDefinitions', () => {
  it('auto-generates id, shortName, and commitPrefix', () => {
    const phases = [
      { name: 'Literature Review', description: 'Review sources', canSkip: false },
      { name: 'Draft', description: 'Write draft', canSkip: false },
      { name: 'Peer Review', description: 'Get feedback', canSkip: true },
    ];

    const result = profilePhasesToDefinitions(phases);

    expect(result[0].id).toBe(1);
    expect(result[0].shortName).toBe('lr');
    expect(result[0].commitPrefix).toBe('literature-review');
    expect(result[0].canSkip).toBe(false);

    expect(result[1].id).toBe(2);
    expect(result[1].shortName).toBe('d');
    expect(result[1].commitPrefix).toBe('draft');

    expect(result[2].id).toBe(3);
    expect(result[2].canSkip).toBe(true);
  });

  it('preserves requiredOutputs when provided', () => {
    const phases = [
      { name: 'Research', description: 'Gather sources', canSkip: false, requiredOutputs: ['bibliography'] },
    ];

    const result = profilePhasesToDefinitions(phases);
    expect(result[0].requiredOutputs).toEqual(['bibliography']);
  });
});

describe('Profile Loader', () => {
  it('loads the built-in software profile', async () => {
    const profile = await loadProfile('software');
    expect(profile).toBeDefined();
    expect(profile!.name).toBe('software');
    expect(profile!.checkpointProtocol).toBe('git');
    expect(profile!.decisionCategories).toContain('architecture');
  });

  it('loads the built-in writing profile', async () => {
    const profile = await loadProfile('writing');
    expect(profile).toBeDefined();
    expect(profile!.name).toBe('writing');
    expect(profile!.experimental).toBe(true);
    expect(profile!.checkpointProtocol).toBe('manual');
    expect(profile!.decisionCategories).toContain('tone');
  });

  it('loads the built-in research profile', async () => {
    const profile = await loadProfile('research');
    expect(profile).toBeDefined();
    expect(profile!.name).toBe('research');
    expect(profile!.experimental).toBe(true);
    expect(profile!.decisionCategories).toContain('methodology');
  });

  it('returns null for unknown profile', async () => {
    const profile = await loadProfile('nonexistent');
    expect(profile).toBeNull();
  });

  it('lists all available profiles', async () => {
    const profiles = await listProfiles();
    const names = profiles.map(p => p.name);
    expect(names).toContain('software');
    expect(names).toContain('writing');
    expect(names).toContain('research');
  });
});
