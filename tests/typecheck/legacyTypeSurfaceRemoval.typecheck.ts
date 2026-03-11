// @ts-expect-error BattleEvent is no longer exported from engine-local battleEngine; import from /types/battle instead.
import type { BattleEvent } from '../../engine/battle/battleEngine';

void (null as unknown as BattleEvent);
