import { writeFileSync } from 'node:fs';
import { exampleContentMaps } from '../../packages/shared/src/content/examples';
import { STATUS_DEFINITIONS } from '../../packages/shared/src/status';
const c=exampleContentMaps();
writeFileSync('art/ui/r2-content.json', JSON.stringify({statuses:Object.values(STATUS_DEFINITIONS).filter(x=>!x.instant),items:[...c.items.values()],equipment:[...c.equipment.values()],sigils:[...c.sigils.values()]},null,2)+'\n');
