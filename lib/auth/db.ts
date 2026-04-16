import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const authPool = new Pool(
  connectionString
    ? {
        connectionString,
      }
    : undefined,
);
