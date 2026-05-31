Ember Maze: A Flame's Journey Through Darkness
CSE352 Computer Graphics

A 3D third-person maze game built in WebGL2 where the player controls a flame navigating through pitch-dark corridors. The flame is both the player character and the sole dynamic point light source. The objective is to reach a lamp at the end of each level while avoiding water hazards. Visibility is severely limited; the player must rely on spatial audio cues to detect nearby dripping water. Upon reaching the lamp, the entire scene lights up to reveal the full maze.

How to Run
1.	Clone or download the repository
2.	Place all files in the same directory, including textures and audio
3.	Serve locally using a local server. Do not open index.html directly in the browser as texture and audio loading require HTTP
Using Python:
python3 -m http.server 8000
Then open http://localhost:8000 in your browser.
Controls:
•	Arrow Left / Right: move
•	Arrow Up: jump
•	Arrow Up + Arrow Left / Right: wall jump
•	☰ (top right): menu, volume, level select

Implementation
Baseline Techniques
•	Phong Lighting: full ambient, diffuse, specular model computed per-fragment with inverse-quadratic point light attenuation (1/(Kc + Kl·d + Kq·d²))
•	Texture Mapping: brick pavement on walls, flame texture on player (that animates using sin + cos), lamp, water, and diamond checkpoint textures; sampled with mipmapping and linear filtering
•	Transformations: dynamic model matrices for all objects, perspective projection, top-down look-at view; surface normals transformed via transpose-inverse model matrix
•	Multiple Light Types: dark phase uses tightly attenuated point light; lit phase (after lamp reached) switches to wide ambient + diffuse fill
•	GLSL Shaders: written in GLSL ES 3.00 with a custom Shader class that caches uniform locations; separate programs for shadow pass, scene pass, bloom extraction, Gaussian blur, and composite
Advanced Techniques
•	Shadow Mapping: omnidirectional cube map shadow system; scene rendered six times per frame (±X, ±Y, ±Z) from the flame's position into a 2048×2048 TEXTURE_CUBE_MAP; fragment shader samples the cube map using the light-to-fragment direction vector to determine occlusion; depth bias of 0.15 prevents self-shadowing artifacts
•	Bloom / HDR Post-Processing: scene rendered into RGBA16F HDR FBO; bright-pass filter extracts pixels above luminance threshold; separable Gaussian blur applied over 6 ping-pong passes; composite pass adds bloom to HDR scene; ACES filmic tonemapping compresses HDR values; dark phase bypasses tonemapper and applies black crush to preserve pitch-black darkness; bloom disabled in dark phase, enabled at strength 0.25 in lit phase
•	Fog: exponential fog in fragment shader: exp(-distance × 1.5) attenuates fragments toward black based on XY distance from flame; only active in dark phase
•	Gamma Correction: pow(color, 1/2.2) applied in composite shader before screen output
Additional Features
•	Flame teardrop shape via per-vertex Y-based non-uniform scaling in vertex shader
•	Animated flame texture using time-based UV offset with sin/cos
•	Irregular flicker lighting via product of three sine waves modulating lightAmbient
•	Spatial Web Audio API with proximity-based volume and stereo panning
•	Checkpoints in level 3
•	Title screen with autonomous bouncing flame
•	Victory screen after completing all three levels
•	Three hand-designed maze layouts with increasing complexity
•	How to Play instructions card
•	Ability to choose what level to play

Challenges
1. Coordinate Orientation Mapping: The 2D maze array rendered flat on its side. Fixed by remapping with r_world = maze.length - 1 - r and aligning collision detection to the X and Y axes.
2. Grid Scale and Collision Failures: Cell dimensions were adjusted to 0.4 units to ensure the maze corridors were wide enough for comfortable navigation. Collision detection uses multi-sampled AABB corner offsets, testing all four corners of the flame's bounding box to prevent wall clipping.
3. Shadow Acne: Self-shadowing artifacts on flat surfaces fixed with slope-dependent bias: max(0.003 × (1.0 - dot(normal, lightDir)), 0.001).
4. Boxy Shadows: Orthographic projection produced rigid box shadows. Switched to perspective projection and added 9-sample PCF (Percentage Closer Filtering) for softer edges.
5. Bloom Overexposure: lightAmbient above 1.0 on the flame caused the entire scene to blow out white. Fixed through extensive fine tuning and different lighting and shadow techniques: wall and background lightAmbient set to 0.0, lightDiffuse kept in the 0.0–0.2 range for non-flame objects, flame lightAmbient raised to HDR range (1.5) to be the only bloom source, bloom threshold tuned to 1.0, bloomStrength reduced to 0.25, per-channel Reinhard tonemapping replaced with ACES filmic tonemapping to preserve color saturation, fog added to darken distant fragments, and omnidirectional cube map shadows to correctly occlude light behind walls. In the dark phase bloom is fully disabled and the tonemapper is bypassed with a black crush applied instead.
6. Dark Phase Brightening: Tonemapper lifted near-zero values above black. Fixed by bypassing tonemapper in dark phase and adding black crush (max(result - 0.04, 0.0)).
7. Single Directional Shadow Map Leaking: Light leaked around walls in all directions not covered by the single depth map. Upgraded to omnidirectional cube map shadow mapping.
8. glMatrix TypeError: Passing plain JS arrays to glMatrix.mat4.lookAt crashed the render loop silently. Fixed by wrapping all inputs with glMatrix.vec3.fromValues().

References
•	Brick Pavement Texture: Charlotte Baglioni, Poly Haven (polyhaven.com), CC0
•	Water Texture: Hazmat Harry, OpenGameArt.org, CC0
•	Water Drop Sound: mattfinarelli, Freesound.org ("Drop - Water"), CC0
•	Flame, Lamp, Diamond textures: AI generated SVGs
•	glMatrix: toji.github.io/gl-matrix, MIT License
•	Bloom / HDR Reference: learnopengl.com

