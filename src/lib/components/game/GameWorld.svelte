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
	import HexGrid from './HexGrid.svelte';import ScorePopup from './ScorePopup.svelte';	import { world, resetWorld, wrapPosition } from '$lib/game/world';
	import {
		generateAsteroids,
		generateNpcs,
		generatePuzzleNodes,
		generatePowerUps,
		resetIdCounter
	} from '$lib/game/procedural';
	import { checkCollisions } from '$lib/game/collision';
	import { checkPuzzleProgress, isPuzzleSolved } from '$lib/game/puzzle';
	import { gameState } from '$lib/stores/gameState.svelte';
	import { inputState } from '$lib/stores/inputState.svelte';
	import { sendPosition } from '$lib/stores/socketClient';

	// Initialize the game world (larger counts for bigger borderless world)
	resetIdCounter();
	resetWorld();
	world.asteroids = generateAsteroids(200, world.bounds);
	world.npcs = generateNpcs(gameState.npcCount, world.bounds);
	world.puzzleNodes = generatePuzzleNodes(12);
	world.powerUps = generatePowerUps(30, world.bounds);

	// Reactive entity lists (controls which components are rendered)
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

			const dx = world.player.position.x - npc.position.x;
			const dy = world.player.position.y - npc.position.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

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
				case 'laser-asteroid': {
					const laser = world.lasers.find((l) => l.id === event.entityA);
					const ast = world.asteroids.find((a) => a.id === event.entityB);
					if (laser && ast) {
						laser.life = 0;
						ast.health -= 15;
						if (ast.health <= 0) {
							ast.destroyed = true;
							if (laser.owner === 'player') {
								gameState.score += Math.round(ast.radius * 10);
							}
						}
					}
					break;
				}
				case 'laser-npc': {
					const laser = world.lasers.find((l) => l.id === event.entityA);
					const npc = world.npcs.find((n) => n.id === event.entityB);
					if (laser && npc) {
						laser.life = 0;
						npc.health -= 20;
						if (npc.health <= 0) {
							npc.destroyed = true;
							const points = 50;
							gameState.score += points;
							spawnScorePopup(npc.position.x, npc.position.y, npc.position.z, points);
						}
					}
					break;
				}
				case 'player-asteroid': {
					const ast = world.asteroids.find((a) => a.id === event.entityB);
					if (ast && !ast.destroyed) {
						gameState.health -= 3;
						world.player.health = gameState.health;
						// Bounce
						const dx = world.player.position.x - ast.position.x;
						const dy = world.player.position.y - ast.position.y;
						const d = Math.sqrt(dx * dx + dy * dy) || 1;
						world.player.position.x += (dx / d) * 2;
						world.player.position.y += (dy / d) * 2;
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
						if (node.position.distanceTo(node.targetPosition) < 3) {
							node.connected = true;
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

		asteroidIds = world.asteroids.filter((a) => !a.destroyed).map((a) => a.id);
		npcIds = world.npcs.filter((n) => !n.destroyed).map((n) => n.id);
		laserIds = world.lasers.filter((l) => l.life > 0).map((l) => l.id);
		powerUpIds = world.powerUps.filter((p) => !p.collected).map((p) => p.id);
		
		// Update other players and remove stale ones (no update in 5 seconds)
		const now = Date.now();
		world.otherPlayers = world.otherPlayers.filter((p) => now - p.lastUpdate < 5000);
		otherPlayerIds = world.otherPlayers.map((p) => p.id);
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

		// Respawn dead NPCs
		const deadNpcs = world.npcs.filter((n) => n.destroyed);
		for (const npc of deadNpcs) {
			npc.destroyed = false;
			npc.health = npc.maxHealth;
			const angle = Math.random() * Math.PI * 2;
			npc.position.set(Math.cos(angle) * 50, Math.sin(angle) * 50, 0);
			npc.shootCooldown = 2 + Math.random() * 2;
		}

		// Respawn collected power-ups
		const collected = world.powerUps.filter((p) => p.collected);
		for (const pu of collected.slice(0, 2)) {
			pu.collected = false;
			pu.position.set(
				(Math.random() - 0.5) * world.bounds.x * 1.5,
				(Math.random() - 0.5) * world.bounds.y * 1.5,
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
