import { world, sphereDistanceSq, surfaceProximity } from './world';

export interface CollisionEvent {
	type:
	| 'laser-npc'
	| 'laser-player'
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

	// Player vs NPCs (only hostile ones) - squared chord distance on sphere
	for (const npc of world.npcs) {
		if (npc.destroyed || npc.converted) continue;
		const d = pr + npc.radius + 0.5;
		if (sphereDistanceSq(pp, npc.position) < d * d) {
			events.push({ type: 'player-npc', entityA: 'player', entityB: npc.id });
		}
	}

	// Player vs PowerUps
	for (const pu of world.powerUps) {
		if (pu.collected) continue;
		const d = pr + pu.radius + 1.5;
		if (sphereDistanceSq(pp, pu.position) < d * d) {
			events.push({ type: 'player-powerup', entityA: 'player', entityB: pu.id });
		}
	}

	// Player vs Puzzle Nodes (angular proximity)
	for (const node of world.puzzleNodes) {
		if (node.connected) continue;
		if (surfaceProximity(pp, node.position) < pr + node.radius + 20) {
			events.push({ type: 'player-puzzlenode', entityA: 'player', entityB: node.id });
		}
	}

	// Lasers vs NPCs
	for (const laser of world.lasers) {
		if (laser.life <= 0) continue;

		if (laser.owner === 'player') {
			for (const npc of world.npcs) {
				if (npc.destroyed || npc.converted) continue;
				const d = laser.radius + npc.radius;
				if (sphereDistanceSq(laser.position, npc.position) < d * d) {
					events.push({ type: 'laser-npc', entityA: laser.id, entityB: npc.id });
				}
			}
		}
	}

	// NPC Lasers vs Player
	for (const laser of world.lasers) {
		if (laser.life <= 0 || laser.owner === 'player') continue;
		const d = pr + laser.radius + 0.5;
		if (sphereDistanceSq(pp, laser.position) < d * d) {
			events.push({ type: 'laser-player', entityA: laser.id, entityB: 'player' });
		}
	}

	return events;
}
