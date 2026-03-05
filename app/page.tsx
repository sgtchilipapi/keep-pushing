'use client';

import { useCallback, useMemo, useState } from 'react';

type CharacterResponse = {
  character: {
    characterId: string;
    userId: string;
    name: string;
    level: number;
    exp: number;
    activeSkills: string[];
    passiveSkills: string[];
  } | null;
};

const ALLOWED_ACTIVE_SKILLS = ['VOLT_STRIKE', 'FINISHING_BLOW'];
const ALLOWED_PASSIVE_SKILLS = ['EAGLE_EYE', 'EXECUTIONER_FOCUS'];

export default function HomePage() {
  const [userId, setUserId] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [name, setName] = useState('Rookie');
  const [activeSkills, setActiveSkills] = useState<string[]>(['VOLT_STRIKE', 'FINISHING_BLOW']);
  const [passiveSkills, setPassiveSkills] = useState<string[]>(['EAGLE_EYE', 'EXECUTIONER_FOCUS']);
  const [status, setStatus] = useState('Idle.');

  const canEquip = useMemo(
    () => characterId.length > 0 && activeSkills.length === 2 && passiveSkills.length === 2,
    [activeSkills, characterId, passiveSkills]
  );

  const createAnonUser = useCallback(async () => {
    const response = await fetch('/api/auth/anon', { method: 'POST' });
    const data = (await response.json()) as { userId?: string; error?: string };

    if (!response.ok || data.userId === undefined) {
      setStatus(data.error ?? 'Could not create anonymous user.');
      return;
    }

    setUserId(data.userId);
    setStatus(`Created anonymous user ${data.userId}`);
  }, []);

  const createCharacter = useCallback(async () => {
    const response = await fetch('/api/character/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name })
    });

    const data = (await response.json()) as { characterId?: string; error?: string };

    if (!response.ok || data.characterId === undefined) {
      setStatus(data.error ?? 'Could not create character.');
      return;
    }

    setCharacterId(data.characterId);
    setStatus(`Created character ${data.characterId}`);
  }, [name, userId]);

  const loadCharacter = useCallback(async () => {
    const response = await fetch(`/api/character?userId=${encodeURIComponent(userId)}`);
    const data = (await response.json()) as CharacterResponse & { error?: string };

    if (!response.ok) {
      setStatus(data.error ?? 'Could not load character.');
      return;
    }

    if (data.character === null) {
      setStatus('No character found for user.');
      return;
    }

    setCharacterId(data.character.characterId);
    setActiveSkills(data.character.activeSkills);
    setPassiveSkills(data.character.passiveSkills);
    setStatus(`Loaded character ${data.character.name} (Lv ${data.character.level})`);
  }, [userId]);

  const equipLoadout = useCallback(async () => {
    const response = await fetch('/api/character/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, activeSkills, passiveSkills })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setStatus(data.error ?? 'Could not equip loadout.');
      return;
    }

    setStatus('Loadout saved.');
  }, [activeSkills, characterId, passiveSkills]);

  return (
    <main style={{ display: 'grid', gap: 12, maxWidth: 560, margin: '2rem auto' }}>
      <h1>Keep Pushing — Character Setup</h1>
      <button onClick={createAnonUser} type="button">
        1) Create Anonymous User
      </button>
      <label>
        User ID
        <input value={userId} onChange={(event) => setUserId(event.target.value)} />
      </label>
      <label>
        Character Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={userId.length === 0} onClick={createCharacter} type="button">
          2) Create Character
        </button>
        <button disabled={userId.length === 0} onClick={loadCharacter} type="button">
          Load Character
        </button>
      </div>

      <p>Character ID: {characterId || '—'}</p>

      <label>
        Active Skill 1
        <select
          value={activeSkills[0]}
          onChange={(event) => setActiveSkills([event.target.value, activeSkills[1]])}
        >
          {ALLOWED_ACTIVE_SKILLS.map((skillId) => (
            <option key={`active-1-${skillId}`} value={skillId}>
              {skillId}
            </option>
          ))}
        </select>
      </label>
      <label>
        Active Skill 2
        <select
          value={activeSkills[1]}
          onChange={(event) => setActiveSkills([activeSkills[0], event.target.value])}
        >
          {ALLOWED_ACTIVE_SKILLS.map((skillId) => (
            <option key={`active-2-${skillId}`} value={skillId}>
              {skillId}
            </option>
          ))}
        </select>
      </label>
      <label>
        Passive Skill 1
        <select
          value={passiveSkills[0]}
          onChange={(event) => setPassiveSkills([event.target.value, passiveSkills[1]])}
        >
          {ALLOWED_PASSIVE_SKILLS.map((passiveId) => (
            <option key={`passive-1-${passiveId}`} value={passiveId}>
              {passiveId}
            </option>
          ))}
        </select>
      </label>
      <label>
        Passive Skill 2
        <select
          value={passiveSkills[1]}
          onChange={(event) => setPassiveSkills([passiveSkills[0], event.target.value])}
        >
          {ALLOWED_PASSIVE_SKILLS.map((passiveId) => (
            <option key={`passive-2-${passiveId}`} value={passiveId}>
              {passiveId}
            </option>
          ))}
        </select>
      </label>

      <button disabled={!canEquip} onClick={equipLoadout} type="button">
        3) Save Equipped Skills
      </button>

      <p>Status: {status}</p>
    </main>
  );
}
