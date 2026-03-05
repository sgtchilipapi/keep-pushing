import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

const pool = new Pool(
  connectionString
    ? {
        connectionString
      }
    : undefined
);

type CharacterCreateInput = {
  userId: string;
  name: string;
  hp: number;
  hpMax: number;
  atk: number;
  def: number;
  spd: number;
  accuracyBP: number;
  evadeBP: number;
  activeSkills: string[];
  passiveSkills: string[];
};

export const prisma = {
  user: {
    async create() {
      const result = await pool.query<{ id: string }>('INSERT INTO "User" DEFAULT VALUES RETURNING id');
      return result.rows[0];
    },
    async findUnique(id: string) {
      const result = await pool.query<{ id: string }>('SELECT id FROM "User" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    }
  },
  character: {
    async create(input: CharacterCreateInput) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const characterResult = await client.query<{
          id: string;
          userId: string;
          name: string;
          level: number;
          exp: number;
          hp: number;
          hpMax: number;
          atk: number;
          def: number;
          spd: number;
          accuracyBP: number;
          evadeBP: number;
        }>(
          `INSERT INTO "Character"
            ("userId", "name", "hp", "hpMax", "atk", "def", "spd", "accuracyBP", "evadeBP")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING id, "userId", name, level, exp, hp, "hpMax", atk, def, spd, "accuracyBP", "evadeBP"`,
          [input.userId, input.name, input.hp, input.hpMax, input.atk, input.def, input.spd, input.accuracyBP, input.evadeBP]
        );
        const character = characterResult.rows[0];

        for (let index = 0; index < input.activeSkills.length; index += 1) {
          const skillId = input.activeSkills[index];
          await client.query('INSERT INTO "SkillUnlock" ("characterId", "skillId") VALUES ($1, $2)', [
            character.id,
            skillId
          ]);
          await client.query(
            'INSERT INTO "EquippedSkill" ("characterId", slot, "skillId") VALUES ($1, $2, $3)',
            [character.id, index, skillId]
          );
        }

        for (let index = 0; index < input.passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" ("characterId", slot, "passiveId") VALUES ($1, $2, $3)',
            [character.id, index, input.passiveSkills[index]]
          );
        }

        await client.query('COMMIT');
        return character;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findByUserId(userId: string) {
      const characterResult = await pool.query(
        'SELECT id, "userId", name, level, exp, hp, "hpMax", atk, def, spd, "accuracyBP", "evadeBP" FROM "Character" WHERE "userId" = $1 LIMIT 1',
        [userId]
      );
      const character = characterResult.rows[0];
      if (character === undefined) {
        return null;
      }

      const [skills, passives, unlocks, inventory] = await Promise.all([
        pool.query('SELECT "skillId" FROM "EquippedSkill" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "passiveId" FROM "EquippedPassive" WHERE "characterId" = $1 ORDER BY slot ASC', [
          character.id
        ]),
        pool.query('SELECT "skillId" FROM "SkillUnlock" WHERE "characterId" = $1 ORDER BY "unlockedAt" ASC', [
          character.id
        ]),
        pool.query('SELECT "itemId", quantity FROM "InventoryItem" WHERE "characterId" = $1 ORDER BY "itemId" ASC', [
          character.id
        ])
      ]);

      return {
        ...character,
        activeSkills: skills.rows.map((row) => row.skillId),
        passiveSkills: passives.rows.map((row) => row.passiveId),
        unlockedSkillIds: unlocks.rows.map((row) => row.skillId),
        inventory: inventory.rows
      };
    },
    async findUnique(id: string) {
      const result = await pool.query('SELECT id FROM "Character" WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] ?? null;
    },
    async updateEquip(characterId: string, activeSkills: string[], passiveSkills: string[]) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM "EquippedSkill" WHERE "characterId" = $1', [characterId]);
        await client.query('DELETE FROM "EquippedPassive" WHERE "characterId" = $1', [characterId]);

        for (let index = 0; index < activeSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedSkill" ("characterId", slot, "skillId") VALUES ($1, $2, $3)',
            [characterId, index, activeSkills[index]]
          );
        }
        for (let index = 0; index < passiveSkills.length; index += 1) {
          await client.query(
            'INSERT INTO "EquippedPassive" ("characterId", slot, "passiveId") VALUES ($1, $2, $3)',
            [characterId, index, passiveSkills[index]]
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }
};
