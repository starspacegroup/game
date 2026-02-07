import { world } from './world';

export interface CollisionEvent {
	type:
	| 'laser-npc'
	| 'player-npc'
	| 'player-powerup'
	| 'player-puzzlenode';
	entityA: string;
	entityB: string;
}

export function checkCollisions(): CollisionEvent[] {
	const events: CollisionEvent[] = [];
	const pp = world.player.position;
	const pr = world.player.radius;

	// Player vs NPCs (only hostile ones)
	for (const npc of world.npcs) {
		if (npc.destroyed || npc.converted) continue;
		if (pp.distanceTo(npc.position) < pr + npc.radius + 0.5) {
			events.push({ type: 'player-npc', entityA: 'player', entityB: npc.id });
		}
	}

	// Player vs PowerUps
	for (const pu of world.powerUps) {
		if (pu.collected) continue;
		if (pp.distanceTo(pu.position) < pr + pu.radius + 1.5) {
			events.push({ type: 'player-powerup', entityA: 'player', entityB: pu.id });
		}
	}

	// Player vs Puzzle Nodes (proximity for interaction)
	for (const node of world.puzzleNodes) {
		if (pp.distanceTo(node.position) < pr + node.radius + 3) {
			events.push({ type: 'player-puzzlenode', entityA: 'player', entityB: node.id });
		}
	}

	// Lasers vs NPCs
	for (const laser of world.lasers) {
		if (laser.life <= 0) continue;

		if (laser.owner === 'player') {
			for (const npc of world.npcs) {
				if (npc.destroyed || npc.converted) continue;
				if (laser.position.distanceTo(npc.position) < laser.radius + npc.radius) {
					events.push({ type: 'laser-npc', entityA: laser.id, entityB: npc.id });
				}
			}
		}
	}

	return events;
}
