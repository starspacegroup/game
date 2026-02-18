import { world, sphereDistance, surfaceProximity } from './world';

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

	// Player vs NPCs (only hostile ones) - chord distance on sphere
	for (const npc of world.npcs) {
		if (npc.destroyed || npc.converted) continue;
		if (sphereDistance(pp, npc.position) < pr + npc.radius + 0.5) {
			events.push({ type: 'player-npc', entityA: 'player', entityB: npc.id });
		}
	}

	// Player vs PowerUps
	for (const pu of world.powerUps) {
		if (pu.collected) continue;
		if (sphereDistance(pp, pu.position) < pr + pu.radius + 1.5) {
			events.push({ type: 'player-powerup', entityA: 'player', entityB: pu.id });
		}
	}

	// Player vs Puzzle Nodes (angular proximity — player on surface, nodes inside sphere)
	// Only interact with nodes from the current wave that aren't yet connected
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
				if (sphereDistance(laser.position, npc.position) < laser.radius + npc.radius) {
					events.push({ type: 'laser-npc', entityA: laser.id, entityB: npc.id });
				}
			}
		}
	}

	// NPC Lasers vs Player
	for (const laser of world.lasers) {
		if (laser.life <= 0 || laser.owner === 'player') continue;
		if (sphereDistance(pp, laser.position) < pr + laser.radius + 0.5) {
			events.push({ type: 'laser-player', entityA: laser.id, entityB: 'player' });
		}
	}

	return events;
}
