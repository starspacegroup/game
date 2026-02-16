<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import FollowCamera from './FollowCamera.svelte';
	import PlayerShip from './PlayerShip.svelte';
	import OtherPlayerShip from './OtherPlayerShip.svelte';
	import Asteroid from './Asteroid.svelte';
	import NpcShip from './NpcShip.svelte';
	import LaserBeam from './LaserBeam.svelte';
	import Starfield from './Starfield.svelte';
	import PuzzleStructure from './PuzzleStructure.svelte';
	import PowerUp from './PowerUp.svelte';
	import HexGrid from './HexGrid.svelte';
	import SphereSurface from './SphereSurface.svelte';import ScorePopup from './ScorePopup.svelte';import ShipExplosion from './ShipExplosion.svelte';	import { world, resetWorld, projectToSphere, projectToTangent, sphereDistance, sphereDirection, getTangentFrame, getPlayerFrame, transportTangent, randomSpherePositionNear, reorthogonalizePlayerUp, SPHERE_RADIUS } from '$lib/game/world';
	import { deathReplay } from '$lib/stores/deathReplay.svelte';
	import {
		generateAsteroids,
		generateNpcs,
		generatePuzzleNodes,
		generatePowerUps,
		resetIdCounter
	} from '$lib/game/procedural';
	import { checkCollisions } from '$lib/game/collision';
	import { checkPuzzleProgress, isPuzzleSolved, findNearestPuzzleNode, generateHint } from '$lib/game/puzzle';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { inputState } from '$lib/stores/inputState.svelte';
	import { sendPosition, sendPuzzleAction, setInput, sendFire, isConnected } from '$lib/stores/socketClient';

	// Render distance for entities - beyond this they're culled (chord distance on sphere)
	// On a sphere with R=200, chord dist ~100 covers about 29° of arc
	const RENDER_DISTANCE = 100;

	// Initialize the game world on sphere surface
	resetIdCounter();
	resetWorld();
	world.asteroids = generateAsteroids(100);
	world.npcs = generateNpcs(gameState.npcCount);
	world.puzzleNodes = generatePuzzleNodes(13);
	world.powerUps = generatePowerUps(50);

	// Reactive entity lists (controls which components are rendered)
	// Entities render at their wrapped position relative to player automatically
	let asteroidIds = $state(world.asteroids.map((a) => a.id));
	let npcIds = $state(world.npcs.map((n) => n.id));
	let laserIds = $state<string[]>([]);
	let powerUpIds = $state(world.powerUps.map((p) => p.id));
	let otherPlayerIds = $state<string[]>([]);

	// Score popups for kill feedback
	interface ScorePopupData {
		id: number;
		x: number;
		y: number;
		z: number;
		points: number;
	}
	let scorePopups = $state<ScorePopupData[]>([]);
	let nextPopupId = 0;

	function spawnScorePopup(x: number, y: number, z: number, points: number): void {
		scorePopups.push({ id: nextPopupId++, x, y, z, points });
	}

	function removeScorePopup(id: number): void {
		scorePopups = scorePopups.filter((p) => p.id !== id);
	}

	let sendTimer = 0;
	let spawnTimer = 0;
	let nextLaserId = 0;
	let collisionCooldown = 0;
	let listUpdateTimer = 0;

	const SHOOT_COOLDOWN = 0.15;
	const LASER_SPEED = 60;
	const LASER_LIFE = 2;
	const NPC_SPEED = 6;
	const NPC_SHOOT_RATE = 5;

	// Main game loop
	useTask((delta) => {
		if (gameState.phase !== 'playing') return;

		// During death replay, only tick the replay and keep entities animating
		if (deathReplay.active) {
			const dt = Math.min(delta, 0.1);
			deathReplay.tick();
			// Keep entities moving for visual continuity during replay
			updateLasers(dt);
			updateAsteroids(dt, gameState.mode === 'multiplayer' && isConnected());
			updateNpcs(dt, gameState.mode === 'multiplayer' && isConnected());
			updateEntityLists(dt);
			return;
		}

		// Clamp delta to avoid physics explosions on tab-switch
		const dt = Math.min(delta, 0.1);

		// In multiplayer, server is authoritative for entity simulation
		const isMP = gameState.mode === 'multiplayer' && isConnected();

		// Client-side prediction: always simulate player locally for responsiveness
		updatePlayer(dt);
		updateShooting(dt);
		updateLasers(dt);

		// Always run entity simulation locally (even in MP) for smooth visuals
		// Server corrections are applied via interpolation in socketClient
		updateAsteroids(dt, isMP);
		updateNpcs(dt, isMP);

		updatePowerUps(dt);

		// Tick buff expiry timers
		gameState.tickBuffs();

		if (!isMP) {
			// Solo mode: client handles all collision detection
			// Check laser collisions every frame (lasers move fast and can skip through targets)
			handleLaserCollisions();

			collisionCooldown -= dt;
			if (collisionCooldown <= 0) {
				collisionCooldown = 0.05; // Check entity collisions ~20fps
				handleCollisions();
			}

			updatePuzzle();
		}

		updateEntityLists(dt);
		syncMultiplayer(dt);

		if (!isMP) {
			respawnEntities(dt);
			spawnNewPowerUps(dt);
		}

		// Record frame for death replay buffer
		deathReplay.record(
			world.player.position.x, world.player.position.y, world.player.position.z,
			world.playerUp.x, world.playerUp.y, world.playerUp.z,
			world.player.rotation.z
		);

		checkGameOver();
	});

	function updatePlayer(dt: number): void {
		const isMultiplayer = gameState.mode === 'multiplayer' && isConnected();

		// Always simulate player movement locally for responsiveness (client-side prediction)
		const speed = world.player.speed * (inputState.boost ? 1.8 : 1);
		let mx = inputState.moveX;
		let my = inputState.moveY;
		// Normalize diagonal movement so it's not faster than cardinal
		const moveMag = Math.sqrt(mx * mx + my * my);
		if (moveMag > 1) {
			mx /= moveMag;
			my /= moveMag;
		}

		// Move along sphere surface using the parallel-transported player frame
		// so controls are relative to the camera, not the geographic poles
		const { east, north } = getPlayerFrame(world.player.position);
		world.player.velocity.copy(east).multiplyScalar(mx * speed).addScaledVector(north, my * speed);

		// Save old position for accurate parallel transport via Rodrigues rotation
		const oldPos = world.player.position.clone();
		world.player.position.addScaledVector(world.player.velocity, dt);
		projectToSphere(world.player.position);

		// Parallel-transport the player's "up" using exact Rodrigues rotation
		transportTangent(world.playerUp, world.player.position, oldPos);

		// Re-orthogonalize every frame to prevent any drift accumulation
		reorthogonalizePlayerUp();

		// Aim rotation (always local for responsiveness)
		// Dead zone: ignore mouse aim near screen center to prevent jittery rotation
		const aimMag = Math.sqrt(inputState.aimX * inputState.aimX + inputState.aimY * inputState.aimY);
		let targetRotZ = world.player.rotation.z;
		if (aimMag > 0.1) {
			targetRotZ = Math.atan2(inputState.aimY, inputState.aimX) - Math.PI / 2;
		} else if (inputState.moveX !== 0 || inputState.moveY !== 0) {
			// Fall back to movement direction when mouse is near center
			targetRotZ = Math.atan2(inputState.moveY, inputState.moveX) - Math.PI / 2;
		}
		// Smooth rotation to target (lerp with shortest-arc handling)
		let angleDiff = targetRotZ - world.player.rotation.z;
		// Wrap to [-PI, PI] for shortest rotation path
		while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
		while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
		const rotSmooth = 1 - Math.exp(-18 * dt); // fast but not instant
		world.player.rotation.z += angleDiff * rotSmooth;
		
		// Send inputs to server in multiplayer mode
		if (isMultiplayer) {
			setInput({
				thrust: inputState.moveX !== 0 || inputState.moveY !== 0,
				brake: inputState.boost,
				rotateX: mx,  // Legacy: abstract move direction
				rotateY: my,  // Legacy: abstract move direction
				rotateZ: world.player.rotation.z,
				// World-space velocity: matches what we just applied locally.
				// Server applies this directly, eliminating frame mismatch.
				velX: world.player.velocity.x,
				velY: world.player.velocity.y,
				velZ: world.player.velocity.z
			});
		}
	}

	function updateShooting(dt: number): void {
		world.player.shootCooldown -= dt;
		if (inputState.shooting && world.player.shootCooldown <= 0) {
			world.player.shootCooldown = SHOOT_COOLDOWN;
			// Ship sprite default "up" is +Y, rotation.z already subtracts PI/2, so add PI/2 to fire forward
			const angle = world.player.rotation.z + Math.PI / 2;
			
			// Fire direction in tangent plane (3D world coords)
			const { east, north } = getPlayerFrame(world.player.position);
			const dir = east.clone().multiplyScalar(Math.cos(angle)).addScaledVector(north, Math.sin(angle));
			
			// Determine how many shots to fire (multishot = 2 lasers spread 1 degree apart)
			const hasMultishot = gameState.hasMultishot;
			const SPREAD_DEG = 1; // degrees between each laser
			const SPREAD_RAD = SPREAD_DEG * (Math.PI / 180);
			// With 2 lasers: offsets are -0.5 and +0.5 (centered spread)
			const shotCount = hasMultishot ? 2 : 1;
			const offsets = hasMultishot ? [-0.5, 0.5] : [0];
			
			for (const offset of offsets) {
				const spreadAngle = angle + offset * SPREAD_RAD;
				const shotDir = east.clone().multiplyScalar(Math.cos(spreadAngle)).addScaledVector(north, Math.sin(spreadAngle));
				
				// Spawn laser from the front of the ship (offset in firing direction on sphere)
				const spawnOffset = 1.5;
				const spawnPos = world.player.position.clone().addScaledVector(shotDir, spawnOffset);
				projectToSphere(spawnPos);
				
				// In multiplayer, send fire event to server which creates authoritative laser
				if (gameState.mode === 'multiplayer' && isConnected()) {
					sendFire(shotDir);
				}
				
				// Create local laser for immediate feedback (client prediction)
				world.lasers.push({
					id: `laser_${nextLaserId++}`,
					position: spawnPos,
					direction: shotDir,
					speed: LASER_SPEED,
					life: LASER_LIFE,
					owner: 'player',
					radius: 0.3
				});
			}
		}
	}

	function updateLasers(dt: number): void {
		for (let i = world.lasers.length - 1; i >= 0; i--) {
			const laser = world.lasers[i];
			laser.position.addScaledVector(laser.direction, laser.speed * dt);
			laser.life -= dt;
			
			// Keep on sphere surface
			projectToSphere(laser.position);
			
			// Parallel-transport direction to stay tangent to sphere at new position.
			// This makes lasers travel along great circles instead of slowing down.
			projectToTangent(laser.direction, laser.position);
			laser.direction.normalize();
			
			if (laser.life <= 0) {
				world.lasers.splice(i, 1);
			}
		}
	}

	function updateAsteroids(dt: number, isMP: boolean): void {
		for (const ast of world.asteroids) {
			if (ast.destroyed) continue;

			if (isMP && ast._serverTarget) {
				// In MP: smoothly interpolate toward server position per-frame.
				// Don't run local drift sim — it fights server corrections and causes jitter.
				const factor = 1 - Math.exp(-8 * dt);
				ast.position.lerp(ast._serverTarget, factor);
				projectToSphere(ast.position);
			} else {
				// Solo / no server target yet: drift on sphere surface using tangent frame.
				// velocity.x = east speed, velocity.y = north speed (matches server convention)
				const { east, north } = getTangentFrame(ast.position);
				ast.position.addScaledVector(east, ast.velocity.x * dt);
				ast.position.addScaledVector(north, ast.velocity.y * dt);
				projectToSphere(ast.position);
			}

			ast.rotation.x += ast.rotationSpeed.x * dt;
			ast.rotation.y += ast.rotationSpeed.y * dt;
		}
	}

	function updateNpcs(dt: number, isMP: boolean): void {
		for (const npc of world.npcs) {
			if (npc.destroyed) continue;

			// In multiplayer, server is authoritative for NPC AI.
			// Just smoothly interpolate position toward server target each frame
			// instead of running local AI which fights server corrections.
			if (isMP) {
				if (npc._serverTarget) {
					const factor = 1 - Math.exp(-10 * dt);
					npc.position.lerp(npc._serverTarget, factor);
					projectToSphere(npc.position);
				}
				// Rotation & conversion state already set by syncNpcs
				continue;
			}

			// Handle converted NPCs - they navigate to puzzle nodes and orbit
			if (npc.converted) {
				updateConvertedNpc(npc, dt);
				continue;
			}

			// Handle conversion animation
			if (npc.conversionProgress > 0 && npc.conversionProgress < 1) {
				npc.conversionProgress += dt * 2; // 0.5 second conversion
				if (npc.conversionProgress >= 1) {
					npc.converted = true;
					npc.conversionProgress = 1;
					// Zero out chase velocity so it doesn't linger
					npc.velocity.set(0, 0, 0);
					gameState.convertedNpcCount++;
					// Find nearest puzzle node (prefer untargeted ones)
					const takenNodeIds = getTargetedNodeIds(npc);
					const nearestNode = findNearestPuzzleNode(npc.position, world.puzzleNodes, takenNodeIds);
					npc.targetNodeId = nearestNode?.id || null;

					// Debug: log ALL node distances for verification
					const allDists = world.puzzleNodes
						.filter(n => !n.connected)
						.map(n => {
							const sp = n.position.clone();
							projectToSphere(sp);
							return { id: n.id, dist: sphereDistance(npc.position, sp) };
						})
						.sort((a, b) => a.dist - b.dist);
					console.log(`[NPC ${npc.id}] Converted at (${npc.position.x.toFixed(0)},${npc.position.y.toFixed(0)},${npc.position.z.toFixed(0)}) → target ${nearestNode?.id || 'NONE'}`);
					console.log(`  All node distances: ${allDists.map(d => `${d.id}=${d.dist.toFixed(1)}`).join(', ')}`);
					console.log(`  Taken: [${[...takenNodeIds].join(', ')}]`);
				}
				// During conversion, spin in place
				npc.rotation.z += dt * 10;
				continue;
			}

			// Chase player on sphere surface
			// sphereDirection returns a tangent-plane vector in WORLD-space (dx,dy,dz).
			// Use it directly as a 3D velocity direction instead of incorrectly decomposing
			// dx/dy as east/north components (which only works at spawn).
			const { dx, dy, dz, dist } = sphereDirection(npc.position, world.player.position);

			if (dist > 0.01) {
				if (dist > 2.5) {
					// Chase: tangent vector IS the correct 3D velocity direction
					npc.velocity.set(dx / dist * NPC_SPEED, dy / dist * NPC_SPEED, dz / dist * NPC_SPEED);
				} else {
					// Circle: perpendicular to chase direction in tangent plane
					const normal = npc.position.clone().normalize();
					const unitDir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
					const perp = new THREE.Vector3().crossVectors(normal, unitDir);
					npc.velocity.copy(perp).multiplyScalar(NPC_SPEED * 0.8);
				}

				// Facing: decompose tangent into local frame via dot products
				const { east, north } = getTangentFrame(npc.position);
				const tangent = new THREE.Vector3(dx, dy, dz);
				const eastComp = tangent.dot(east);
				const northComp = tangent.dot(north);
				npc.rotation.z = Math.atan2(eastComp, -northComp);
			}

			npc.position.addScaledVector(npc.velocity, dt);
			projectToSphere(npc.position);

			// NPC shooting
			npc.shootCooldown -= dt;
			if (npc.shootCooldown <= 0 && dist < 40) {
				npc.shootCooldown = NPC_SHOOT_RATE + Math.random();
				// Fire toward player: tangent vector is already the correct 3D direction
				const fireDir = dist > 0.01
					? new THREE.Vector3(dx / dist, dy / dist, dz / dist)
					: getTangentFrame(npc.position).east.clone();
				world.lasers.push({
					id: `laser_${nextLaserId++}`,
					position: npc.position.clone(),
					direction: fireDir,
					speed: LASER_SPEED * 0.5,
					life: LASER_LIFE * 0.7,
					owner: npc.id,
					radius: 0.2
				});
			}
		}
	}

	/** Get set of node IDs already targeted by other converted NPCs (excluding the given NPC) */
	function getTargetedNodeIds(excludeNpc: typeof world.npcs[0]): Set<string> {
		const ids = new Set<string>();
		for (const other of world.npcs) {
			if (other === excludeNpc || other.destroyed || !other.converted) continue;
			if (other.targetNodeId) ids.add(other.targetNodeId);
		}
		return ids;
	}

	function updateConvertedNpc(npc: typeof world.npcs[0], dt: number): void {
		// Find target puzzle node
		let targetNode = world.puzzleNodes.find(n => n.id === npc.targetNodeId);
		
		// Reassign if no target or current target is already connected
		if (!targetNode || targetNode.connected) {
			const takenNodeIds = getTargetedNodeIds(npc);
			const nearest = findNearestPuzzleNode(npc.position, world.puzzleNodes, takenNodeIds);
			if (nearest) {
				targetNode = nearest;
				npc.targetNodeId = nearest.id;
			} else {
				return; // No unconnected nodes left
			}
		}
		if (!targetNode) return;

		// NPC stays on the sphere surface.
		// Orbit the surface point directly above the puzzle node.
		const surfaceTarget = targetNode.position.clone();
		projectToSphere(surfaceTarget);
		const dist = sphereDistance(npc.position, surfaceTarget);

		if (dist > npc.orbitDistance + 2) {
			// Navigate on sphere surface toward the point above the node
			const { dx, dy, dz, dist: dMag } = sphereDirection(npc.position, surfaceTarget);
			const navSpeed = NPC_SPEED * 3;
			if (dMag > 0.01) {
				npc.velocity.set(dx / dMag * navSpeed, dy / dMag * navSpeed, dz / dMag * navSpeed);
				const { east, north } = getTangentFrame(npc.position);
				const tangent = new THREE.Vector3(dx, dy, dz);
				npc.rotation.z = Math.atan2(tangent.dot(east), -tangent.dot(north));
			}
			npc.position.addScaledVector(npc.velocity, dt);
			projectToSphere(npc.position);
		} else {
			// Orbit on sphere surface above the node
			npc.orbitAngle += dt * 1.5;
			const { east: te, north: tn } = getTangentFrame(surfaceTarget);
			npc.position.copy(surfaceTarget)
				.addScaledVector(te, Math.cos(npc.orbitAngle) * npc.orbitDistance)
				.addScaledVector(tn, Math.sin(npc.orbitAngle) * npc.orbitDistance);
			projectToSphere(npc.position);
			npc.rotation.z = npc.orbitAngle + Math.PI / 2;
			
			// Generate hints while orbiting
			npc.hintTimer -= dt;
			if (npc.hintTimer <= 0) {
				npc.hintTimer = 4 + Math.random() * 3;
				const hint = generateHint(targetNode, world.puzzleNodes);
				npc.hintData = hint;
				gameState.addHint(targetNode.id, hint);
				if (gameState.isAlive) gameState.score += 5;
				
				// Help push the node toward its target inside the sphere
				if (!targetNode.connected) {
					targetNode.position.lerp(targetNode.targetPosition, 0.01);
				}
			}
		}
	}

	function updatePowerUps(dt: number): void {
		for (const pu of world.powerUps) {
			if (pu.collected) continue;
			pu.bobPhase += dt * 2;
		}
	}

	function handleLaserCollisions(): void {
		// Runs every frame to prevent fast lasers passing through NPCs
		for (const laser of world.lasers) {
			if (laser.life <= 0 || laser.owner !== 'player') continue;
			for (const npc of world.npcs) {
				// Skip destroyed, converted, or already-converting NPCs (don't waste lasers)
				if (npc.destroyed || npc.converted || npc.conversionProgress > 0) continue;
				// Use generous hit radius: sum of radii + extra tolerance for fast projectiles
				if (sphereDistance(laser.position, npc.position) < laser.radius + npc.radius + 1.0) {
					laser.life = 0;
					npc.conversionProgress = 0.01;
					const points = 25;
					if (gameState.isAlive) gameState.score += points;
					spawnScorePopup(npc.position.x, npc.position.y, npc.position.z, points);
					break; // This laser is consumed, move to next
				}
			}
		}
	}

	function handleCollisions(): void {
		const events = checkCollisions();
		for (const event of events) {
			switch (event.type) {
				case 'laser-npc':
					// Handled every frame in handleLaserCollisions
					break;
				case 'laser-player': {
					if (Date.now() < world.player.damageCooldownUntil) break;
					const laser = world.lasers.find((l) => l.id === event.entityA);
					if (laser) {
						laser.life = 0;
						const rawDmg = 15;
						const overflow = gameState.applyShieldDamage(rawDmg);
						if (overflow > 0) {
							gameState.health = Math.max(0, gameState.health - overflow);
							world.player.health = gameState.health;
							gameState.flashDamage();
						}
					}
					break;
				}
				case 'player-npc': {
					if (Date.now() < world.player.damageCooldownUntil) break;
					const npcDmg = 25;
					const npcOverflow = gameState.applyShieldDamage(npcDmg);
					if (npcOverflow > 0) {
						gameState.health = Math.max(0, gameState.health - npcOverflow);
						world.player.health = gameState.health;
						gameState.flashDamage();
					}
					// Skip teleport if this hit killed the player
					if (gameState.health <= 0) break;
					// Teleport player a short distance away from the NPC
					let safePos = randomSpherePositionNear(world.player.position, 10, 20);
					let attempts = 0;
					while (attempts < 10) {
						const tooClose = world.npcs.some(
							(n) => !n.destroyed && sphereDistance(safePos, n.position) < 8
						);
						if (!tooClose) break;
						safePos = randomSpherePositionNear(world.player.position, 10, 20);
						attempts++;
					}
					world.player.position.copy(safePos);
					projectToSphere(world.player.position);
					// Re-derive playerUp for the new position
					reorthogonalizePlayerUp();
					world.player.velocity.set(0, 0, 0);
					// 1-second invincibility
					world.player.damageCooldownUntil = Date.now() + 1000;
					break;
				}
				case 'player-powerup': {
					const pu = world.powerUps.find((p) => p.id === event.entityB);
					if (pu && !pu.collected) {
						pu.collected = true;
						switch (pu.type) {
							case 'health': {
								const healAmount = 25;
								const before = gameState.health;
								gameState.health = Math.min(gameState.maxHealth, gameState.health + healAmount);
								const actual = Math.round(gameState.health - before);
								gameState.flashHealth();
								gameState.notifyPickup('health', `+${actual} HP restored`);
								break;
							}
							case 'speed': {
								const speedDuration = 8000;
								world.player.speed = 20;
								gameState.addBuff('speed', speedDuration);
								gameState.notifyPickup('speed', `Speed x1.7 for ${speedDuration / 1000}s`);
								setTimeout(() => {
									world.player.speed = 12;
								}, speedDuration);
								break;
							}
							case 'multishot': {
								const multiDuration = 10000;
								if (gameState.isAlive) gameState.score += 25;
								gameState.addBuff('multishot', multiDuration);
								gameState.notifyPickup('multishot', `+25 points & multi-shot for ${multiDuration / 1000}s`);
								break;
							}
							case 'shield': {
								const shieldHeal = 50;
								const shieldDuration = 12000;
								const before2 = gameState.health;
								gameState.health = Math.min(gameState.maxHealth, gameState.health + shieldHeal);
								const actual2 = Math.round(gameState.health - before2);
								gameState.flashHealth();
								gameState.addBuff('shield', shieldDuration);
								gameState.notifyPickup('shield', `+${actual2} HP & shield (${gameState.maxShieldHealth} HP) for ${shieldDuration / 1000}s`);
								break;
							}
						}
					}
					break;
				}
				case 'player-puzzlenode': {
					const node = world.puzzleNodes.find((n) => n.id === event.entityB);
					if (node && inputState.interact && !node.connected) {
						// Lerp node toward target inside the sphere (no surface projection)
						node.position.lerp(node.targetPosition, 0.05);
						// Sync puzzle node movement to server
						sendPuzzleAction(
							node.id,
							'move',
							{ x: node.position.x, y: node.position.y, z: node.position.z },
							false
						);
						if (node.position.distanceTo(node.targetPosition) < 8) {
							node.connected = true;
							sendPuzzleAction(
								node.id,
								'connect',
								{ x: node.position.x, y: node.position.y, z: node.position.z },
								true
							);
						}
					}
					break;
				}
			}
		}
	}

	function updatePuzzle(): void {
		gameState.puzzleProgress = checkPuzzleProgress(world.puzzleNodes);
		if (isPuzzleSolved(world.puzzleNodes) && !gameState.puzzleSolved) {
			gameState.puzzleSolved = true;
			if (gameState.isAlive) gameState.score += 1000;
		}
	}

	function updateEntityLists(dt: number): void {
		listUpdateTimer += dt;
		if (listUpdateTimer < 0.15) return; // Update lists ~7 times/sec
		listUpdateTimer = 0;

		// Helper to check if entity is in view range using sphere chord distance
		const isVisible = (pos: THREE.Vector3): boolean => 
			sphereDistance(world.player.position, pos) <= RENDER_DISTANCE;

		// Asteroids: filter by view distance
		asteroidIds = world.asteroids.filter((a) => !a.destroyed && isVisible(a.position)).map((a) => a.id);

		// NPCs: filter by view distance (always show converted allies)
		npcIds = world.npcs.filter((n) => !n.destroyed && (n.converted || isVisible(n.position))).map((n) => n.id);

		// Lasers: filter by view distance
		laserIds = world.lasers.filter((l) => l.life > 0 && isVisible(l.position)).map((l) => l.id);

		// Power-ups: filter by view distance
		powerUpIds = world.powerUps.filter((p) => !p.collected && isVisible(p.position)).map((p) => p.id);
		
		// Update other players and remove stale ones (no update in 5 seconds)
		const now = Date.now();
		world.otherPlayers = world.otherPlayers.filter((p) => now - p.lastUpdate < 5000);
		otherPlayerIds = world.otherPlayers.filter((p) => isVisible(p.position)).map((p) => p.id);
	}

	function syncMultiplayer(dt: number): void {
		sendTimer += dt;
		if (sendTimer > 0.05) {
			sendTimer = 0;
			sendPosition();
		}
	}

	// Separate timer for power-up spawning (faster than general respawn)
	let powerUpSpawnTimer = 0;
	const MAX_POWERUPS = 80;
	const POWERUP_SPAWN_INTERVAL = 8; // seconds between spawn checks
	const POWERUP_MIN_DIST = 8; // don't spawn directly on top of player
	const POWERUP_TYPES: ('health' | 'speed' | 'multishot' | 'shield')[] = ['health', 'speed', 'multishot', 'shield'];

	function respawnEntities(dt: number): void {
		spawnTimer += dt;
		if (spawnTimer < 6) return;
		spawnTimer = 0;

		// Respawn destroyed asteroids on random sphere positions
		const deadAst = world.asteroids.filter((a) => a.destroyed);
		for (const ast of deadAst.slice(0, 3)) {
			ast.destroyed = false;
			ast.health = ast.maxHealth;
			const pos = randomSpherePositionNear(world.player.position, 35, 100);
			ast.position.copy(pos);
		}

		// Spawn new hostile NPCs if too few hostile ones remain
		const hostileNpcs = world.npcs.filter((n) => !n.destroyed && !n.converted && n.conversionProgress === 0);
		if (hostileNpcs.length < 1) {
			// Add a new hostile NPC far from the player (off-screen)
			const pos = randomSpherePositionNear(world.player.position, 55, 100);
			world.npcs.push({
				id: `npc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
				position: pos,
				velocity: new THREE.Vector3(0, 0, 0),
				rotation: new THREE.Euler(0, 0, 0),
				radius: 1.2,
				health: 30,
				maxHealth: 30,
				shootCooldown: 2 + Math.random() * 2,
				destroyed: false,
				converted: false,
				conversionProgress: 0,
				targetNodeId: null,
				orbitAngle: Math.random() * Math.PI * 2,
				orbitDistance: 5 + Math.random() * 3,
				hintTimer: 3 + Math.random() * 2,
				hintData: null
			});
		}

		// Recycle collected power-ups — reposition them away from the player
		const collected = world.powerUps.filter((p) => p.collected);
		for (const pu of collected.slice(0, 3)) {
			pu.collected = false;
			pu.type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
			const pos = randomSpherePositionNear(world.player.position, POWERUP_MIN_DIST, 80);
			pu.position.copy(pos);
			pu.bobPhase = Math.random() * Math.PI * 2;
		}
	}

	/** Spawn brand-new power-ups over time, similar to how satellites appear */
	function spawnNewPowerUps(dt: number): void {
		powerUpSpawnTimer += dt;
		if (powerUpSpawnTimer < POWERUP_SPAWN_INTERVAL) return;
		powerUpSpawnTimer = 0;

		// Count active (uncollected) power-ups
		const activeCount = world.powerUps.filter((p) => !p.collected).length;
		if (activeCount >= MAX_POWERUPS) return;

		// Spawn 1-3 new power-ups each cycle
		const spawnCount = 1 + Math.floor(Math.random() * 3);
		for (let i = 0; i < spawnCount && (activeCount + i) < MAX_POWERUPS; i++) {
			// Can appear on screen (min dist 8) but not directly on the player
			const pos = randomSpherePositionNear(world.player.position, POWERUP_MIN_DIST, 60);
			world.powerUps.push({
				id: `pwr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
				position: pos,
				type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
				radius: 0.8,
				collected: false,
				bobPhase: Math.random() * Math.PI * 2
			});
		}
	}

	function checkGameOver(): void {
		if (gameState.health <= 0) {
			gameState.health = 0;

			// Reset score to 0 on death
			gameState.score = 0;

			// Start death replay — camera will replay last 5 seconds while overlay fades in
			deathReplay.startReplay();

			if (gameState.mode === 'multiplayer') {
				// In multiplayer, show the death screen instead of full game-over.
				// Stay connected so we receive room-stats and can rejoin.
				gameState.multiplayerDead = true;
			} else {
				// Solo mode: flag death for the replay, phase changes after replay
				gameState.multiplayerDead = true;
			}
		}
	}
</script>

<!-- Camera -->
<FollowCamera />

<!-- Lighting — sun-like directional for sphere surface visibility -->
<T.AmbientLight intensity={0.15} color="#334466" />
<T.DirectionalLight position={[120, 80, 160]} intensity={0.8} color="#ffffee" />
<T.DirectionalLight position={[-80, -40, 80]} intensity={0.25} color="#4466aa" />
<T.PointLight position={[0, 0, 0]} intensity={0.3} color="#6688ff" distance={SPHERE_RADIUS * 1.2} />

<!-- Fog for depth — tuned for sphere radius so horizon is visible -->
<T.FogExp2 args={['#000811', 0.004]} attach="fog" />

<!-- Background stars -->
<Starfield count={2500} />

<!-- Sphere surface — visible planet ground with grid lines -->
<SphereSurface />

<!-- Hex grid (strategic area) -->
<HexGrid />

<!-- Player ship -->
<PlayerShip />

<!-- Ship explosion debris on death -->
<ShipExplosion />

<!-- Other players -->
{#each otherPlayerIds as id (id)}
	<OtherPlayerShip {id} />
{/each}

<!-- Asteroids -->
{#each asteroidIds as id (id)}
	<Asteroid {id} />
{/each}

<!-- NPCs -->
{#each npcIds as id (id)}
	<NpcShip {id} />
{/each}

<!-- Lasers -->
{#each laserIds as id (id)}
	<LaserBeam {id} />
{/each}

<!-- Power-ups -->
{#each powerUpIds as id (id)}
	<PowerUp {id} />
{/each}

<!-- Puzzle structure -->
<PuzzleStructure />

<!-- Score popups -->
{#each scorePopups as popup (popup.id)}
	<ScorePopup
		x={popup.x}
		y={popup.y}
		z={popup.z}
		points={popup.points}
		onComplete={() => removeScorePopup(popup.id)}
	/>
{/each}
