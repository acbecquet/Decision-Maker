import { mkdirSync, rmSync } from 'node:fs';

mkdirSync('e2e/.tmp', { recursive: true });
for (const name of ['e2e.db', 'e2e.db-wal', 'e2e.db-shm']) {
	rmSync(`e2e/.tmp/${name}`, { force: true });
}
