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
	import HexGrid from './HexGrid.svelte';import ScorePopup from './ScorePopup.svelte';	import { world, resetWorld, wrapPosition, wrappedDistance, wrappedDirection } from '$lib/game/world';
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
	import { sendPosition, sendPuzzleAction } from '$lib/stores/socketClient';
	import { VIEW_DISTANCE } from '$lib/game/chunk';

	// Render distance for entities - beyond this they're culled
	const RENDER_DISTANCE = VIEW_DISTANCE;

	// Initialize the game world (larger counts for 4232x4232 world)
	resetIdCounter();
	resetWorld();
	world.asteroids = generateAsteroids(600, world.bounds);
	world.npcs = generateNpcs(gameState.npcCount, world.bounds);
	world.puzzleNodes = generatePuzzleNodes(12);
	world.powerUps = generatePowerUps(100, world.bounds);

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
	const NPC_SHOOT_RATE = 2.5;

	// Main game loop
	useTask((delta) => {
		if (gameState.phase !== 'playing') return;

		// Clamp delta to avoid physics explosions on tab-switch
		const dt = Math.min(delta, 0.1);

		updatePlayer(dt);
		updateShooting(dt);
		updateLasers(dt);
		updateAsteroids(dt);
		updateNpcs(dt);
		updatePowerUps(dt);

		collisionCooldown -= dt;
		if (collisionCooldown <= 0) {
			collisionCooldown = 0.05; // Check collisions ~20fps
			handleCollisions();
		}

		updatePuzzle();
		updateEntityLists(dt);
		syncMultiplayer(dt);
		respawnEntities(dt);
		checkGameOver();
	});

	function updatePlayer(dt: number): void {
		const speed = world.player.speed * (inputState.boost ? 1.8 : 1);
		world.player.velocity.x = inputState.moveX * speed;
		world.player.velocity.y = inputState.moveY * speed;
		world.player.position.x += world.player.velocity.x * dt;
		world.player.position.y += world.player.velocity.y * dt;

		// Wrap around for borderless world
		wrapPosition(world.player.position);

		// Aim rotation
		if (inputState.aimX !== 0 || inputState.aimY !== 0) {
			world.player.rotation.z = Math.atan2(inputState.aimY, inputState.aimX) - Math.PI / 2;
		}
	}

	function updateShooting(dt: number): void {
		world.player.shootCooldown -= dt;
		if (inputState.shooting && world.player.shootCooldown <= 0) {
			world.player.shootCooldown = SHOOT_COOLDOWN;
			const angle = world.player.rotation.z + Math.PI / 2;
			world.lasers.push({
				id: `laser_${nextLaserId++}`,
				position: world.player.position.clone(),
				direction: new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0),
				speed: LASER_SPEED,
				life: LASER_LIFE,
				owner: 'player',
				radius: 0.3
			});
		}
	}

	function updateLasers(dt: number): void {
		for (let i = world.lasers.length - 1; i >= 0; i--) {
			const laser = world.lasers[i];
			laser.position.addScaledVector(laser.direction, laser.speed * dt);
			laser.life -= dt;
			
			// Wrap around for borderless world
			wrapPosition(laser.position);
			
			if (laser.life <= 0) {
				world.lasers.splice(i, 1);
			}
		}
	}

	function updateAsteroids(dt: number): void {
		for (const ast of world.asteroids) {
			if (ast.destroyed) continue;
			ast.position.addScaledVector(ast.velocity, dt);
			ast.rotation.x += ast.rotationSpeed.x * dt;
			ast.rotation.y += ast.rotationSpeed.y * dt;

			// Wrap around for borderless world
			wrapPosition(ast.position);
		}
	}

	function updateNpcs(dt: number): void {
		for (const npc of world.npcs) {
			if (npc.destroyed) continue;

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
					gameState.convertedNpcCount++;
					// Find nearest puzzle node to orbit
					const nearestNode = findNearestPuzzleNode(npc.position, world.puzzleNodes);
					npc.targetNodeId = nearestNode?.id || null;
				}
				// During conversion, spin in place
				npc.rotation.z += dt * 10;
				return;
			}

			// Use wrapped direction for toroidal world (NPC chases via shortest path)
			const { dx, dy, dist } = wrappedDirection(npc.position, world.player.position);

			if (dist > 2.5) {
				// Chase until very close
				npc.velocity.x = (dx / dist) * NPC_SPEED;
				npc.velocity.y = (dy / dist) * NPC_SPEED;
			} else {
				// Circle tightly - close enough to hit
				npc.velocity.x = (-dy / dist) * NPC_SPEED * 0.8;
				npc.velocity.y = (dx / dist) * NPC_SPEED * 0.8;
			}

			npc.position.addScaledVector(npc.velocity, dt);
			npc.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;

			// Wrap around for borderless world
			wrapPosition(npc.position);

			// NPC shooting
			npc.shootCooldown -= dt;
			if (npc.shootCooldown <= 0 && dist < 40) {
				npc.shootCooldown = NPC_SHOOT_RATE + Math.random();
				const angle = Math.atan2(dy, dx);
				world.lasers.push({
					id: `laser_${nextLaserId++}`,
					position: npc.position.clone(),
					direction: new THREE.Vector3(
						Math.cos(angle + Math.PI),
						Math.sin(angle + Math.PI),
						0
					),
					speed: LASER_SPEED * 0.5,
					life: LASER_LIFE * 0.7,
					owner: npc.id,
					radius: 0.2
				});
			}
		}
	}

	function updateConvertedNpc(npc: typeof world.npcs[0], dt: number): void {
		// Find target puzzle node
		let targetNode = world.puzzleNodes.find(n => n.id === npc.targetNodeId);
		
		// If no target or target node moved far, find a new one
		if (!targetNode) {
			const nearest = findNearestPuzzleNode(npc.position, world.puzzleNodes);
			if (nearest) {
				targetNode = nearest;
				npc.targetNodeId = nearest.id;
			}
		}
		
		if (!targetNode) return;

		const dx = targetNode.position.x - npc.position.x;
		const dy = targetNode.position.y - npc.position.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		// Navigate to the puzzle node if far away
		if (dist > npc.orbitDistance + 2) {
			const navSpeed = NPC_SPEED * 1.2;
			npc.velocity.x = (dx / dist) * navSpeed;
			npc.velocity.y = (dy / dist) * navSpeed;
			npc.position.addScaledVector(npc.velocity, dt);
			npc.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
		} else {
			// Orbit the puzzle node
			npc.orbitAngle += dt * 1.5; // Orbit speed
			npc.position.x = targetNode.position.x + Math.cos(npc.orbitAngle) * npc.orbitDistance;
			npc.position.y = targetNode.position.y + Math.sin(npc.orbitAngle) * npc.orbitDistance;
			npc.rotation.z = npc.orbitAngle + Math.PI / 2;
			
			// Generate hints while orbiting
			npc.hintTimer -= dt;
			if (npc.hintTimer <= 0) {
				npc.hintTimer = 4 + Math.random() * 3; // 4-7 seconds between hints
				const hint = generateHint(targetNode, world.puzzleNodes);
				npc.hintData = hint;
				gameState.addHint(targetNode.id, hint);
				gameState.score += 5; // Small score bonus for data collection
				
				// Help push the node toward its target (converted NPCs contribute to solving)
				if (!targetNode.connected) {
					targetNode.position.lerp(targetNode.targetPosition, 0.01);
				}
			}
		}

		// Wrap position
		wrapPosition(npc.position);
	}

	function updatePowerUps(dt: number): void {
		for (const pu of world.powerUps) {
			if (pu.collected) continue;
			pu.bobPhase += dt * 2;
		}
	}

	function handleCollisions(): void {
		const events = checkCollisions();
		for (const event of events) {
			switch (event.type) {
				case 'laser-npc': {
					const laser = world.lasers.find((l) => l.id === event.entityA);
					const npc = world.npcs.find((n) => n.id === event.entityB);
					if (laser && npc && !npc.converted) {
						laser.life = 0;
						// Start conversion process instead of destroying
						if (npc.conversionProgress === 0) {
							npc.conversionProgress = 0.01; // Start conversion
							const points = 25;
							gameState.score += points;
							spawnScorePopup(npc.position.x, npc.position.y, npc.position.z, points);
						}
					}
					break;
				}
				case 'player-npc': {
					gameState.health = 0;
					world.player.health = 0;
					break;
				}
				case 'player-powerup': {
					const pu = world.powerUps.find((p) => p.id === event.entityB);
					if (pu && !pu.collected) {
						pu.collected = true;
						switch (pu.type) {
							case 'health':
								gameState.health = Math.min(gameState.maxHealth, gameState.health + 25);
								break;
							case 'speed':
								world.player.speed = 30;
								setTimeout(() => {
									world.player.speed = 20;
								}, 8000);
								break;
							case 'multishot':
								gameState.score += 25;
								break;
							case 'shield':
								gameState.health = Math.min(gameState.maxHealth, gameState.health + 50);
								break;
						}
					}
					break;
				}
				case 'player-puzzlenode': {
					const node = world.puzzleNodes.find((n) => n.id === event.entityB);
					if (node && inputState.interact && !node.connected) {
						node.position.lerp(node.targetPosition, 0.05);
						// Sync puzzle node movement to server
						sendPuzzleAction(
							node.id,
							'move',
							{ x: node.position.x, y: node.position.y, z: node.position.z },
							false
						);
						if (node.position.distanceTo(node.targetPosition) < 3) {
							node.connected = true;
							// Sync puzzle node connection to server
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
			gameState.score += 1000;
		}
	}

	function updateEntityLists(dt: number): void {
		listUpdateTimer += dt;
		if (listUpdateTimer < 0.15) return; // Update lists ~7 times/sec
		listUpdateTimer = 0;

		// Helper to check if entity is in view range using wrapped distance
		const isVisible = (pos: THREE.Vector3): boolean => 
			wrappedDistance(world.player.position, pos) <= RENDER_DISTANCE;

		// Asteroids: filter by view distance
		asteroidIds = world.asteroids.filter((a) => !a.destroyed && isVisible(a.position)).map((a) => a.id);

		// NPCs: filter by view distance
		npcIds = world.npcs.filter((n) => !n.destroyed && isVisible(n.position)).map((n) => n.id);

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

	function respawnEntities(dt: number): void {
		spawnTimer += dt;
		if (spawnTimer < 6) return;
		spawnTimer = 0;

		// Respawn destroyed asteroids
		const deadAst = world.asteroids.filter((a) => a.destroyed);
		for (const ast of deadAst.slice(0, 3)) {
			ast.destroyed = false;
			ast.health = ast.maxHealth;
			ast.position.set(
				(Math.random() - 0.5) * world.bounds.x * 2,
				(Math.random() - 0.5) * world.bounds.y * 2,
				(Math.random() - 0.5) * 5
			);
		}

		// Spawn new hostile NPCs if too few hostile ones remain
		// (converted NPCs don't count as we want a steady stream of enemies)
		const hostileNpcs = world.npcs.filter((n) => !n.destroyed && !n.converted && n.conversionProgress === 0);
		if (hostileNpcs.length < 2) {
			// Add a new hostile NPC from a distance (spawn within view range)
			const angle = Math.random() * Math.PI * 2;
			const dist = 80 + Math.random() * 40;
			let spawnX = world.player.position.x + Math.cos(angle) * dist;
			let spawnY = world.player.position.y + Math.sin(angle) * dist;
			// Wrap spawn position into world bounds
			const bx = world.bounds.x;
			const by = world.bounds.y;
			if (spawnX > bx) spawnX -= bx * 2;
			else if (spawnX < -bx) spawnX += bx * 2;
			if (spawnY > by) spawnY -= by * 2;
			else if (spawnY < -by) spawnY += by * 2;
			world.npcs.push({
				id: `npc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
				position: new THREE.Vector3(spawnX, spawnY, 0),
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

		// Respawn collected power-ups
		const collected = world.powerUps.filter((p) => p.collected);
		for (const pu of collected.slice(0, 2)) {
			pu.collected = false;
			pu.position.set(
				(Math.random() - 0.5) * world.bounds.x * 2,
				(Math.random() - 0.5) * world.bounds.y * 2,
				(Math.random() - 0.5) * 3
			);
		}
	}

	function checkGameOver(): void {
		if (gameState.health <= 0) {
			gameState.health = 0;
			gameState.phase = 'gameover';
		}
	}
</script>

<!-- Camera -->
<FollowCamera />

<!-- Lighting -->
<T.AmbientLight intensity={0.12} color="#334466" />
<T.DirectionalLight position={[50, 30, 50]} intensity={0.7} color="#ffffff" />
<T.DirectionalLight position={[-30, -20, 30]} intensity={0.2} color="#4466aa" />
<T.PointLight position={[0, 0, 25]} intensity={0.4} color="#6688ff" distance={100} />

<!-- Fog for depth -->
<T.FogExp2 args={['#000011', 0.003]} attach="fog" />

<!-- Background stars -->
<Starfield count={2500} />

<!-- Hex grid (Kadis-Kot strategic area) -->
<HexGrid />

<!-- Player ship -->
<PlayerShip />

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

<!-- Puzzle structure (Kal-Toh) -->
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
