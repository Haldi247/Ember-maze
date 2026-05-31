"use strict";

// ─── EXISTING SHADERS ─────────────────────────────────────────────

var vertexShaderSource = `#version 300 es
    precision mediump float;
    layout(location = 0) in vec3 aPos;
    layout(location = 1) in vec3 aNormal;
    layout(location = 2) in vec2 aTexCoord;
    uniform mat4 model, view, projection;
    uniform float isFlame;
    out vec3 FragPos, Normal;
    out vec2 FragUV;
    void main() 
    {
        vec3 pos = aPos;
        if (isFlame > 0.5) {
            // aPos.y ranges from -0.5 to 0.5
            // wider at bottom (-0.5), narrower at top (0.5)
            float t = (pos.y + 0.5); // 0 at bottom, 1 at top
            float scale = mix(1.4, 0.3, t); // 1.4x wide at base, 0.3x at tip
            pos.x *= scale;
            pos.z *= scale;
        }
        FragPos = vec3(model * vec4(pos, 1.0));
        Normal = mat3(transpose(inverse(model))) * aNormal;
        FragUV = aTexCoord;
        gl_Position = projection * view * vec4(FragPos, 1.0);
    }`;

var fragmentShaderSource = `#version 300 es
    precision mediump float;
    in vec3 FragPos, Normal;
    in vec2 FragUV;
    uniform vec3 lightPos, lightAmbient, lightDiffuse, lightSpecular;
    uniform float constant, linear, quadratic;
    uniform vec3 matDiffuse, matSpecular, viewPos;
    uniform float shininess;
    uniform float proximityBoost;
    uniform samplerCube shadowMap;
    uniform float farPlane;
    uniform sampler2D wallTexture;
    uniform float useTexture;
    uniform float uTime;
    uniform float fogEnabled;
    uniform float isFlame;

    float ShadowCalculation(vec3 fragPos) {
        vec3 fragToLight = fragPos - lightPos;
        float closestDepth = texture(shadowMap, fragToLight).r * farPlane;
        float currentDepth = length(fragToLight);
        float bias = 0.15;
        return currentDepth - bias > closestDepth ? 1.0 : 0.0;
    }

    out vec4 FragColor;
    void main() 
    {
        vec3 norm = normalize(Normal);
        vec3 lightDir = normalize(lightPos - FragPos);
        float dist = length(lightPos - FragPos);
        vec3 viewDir = normalize(viewPos - FragPos);
        vec3 reflectDir = reflect(-lightDir, norm);

        vec3 effectiveDiffuse = matDiffuse;
        if (useTexture > 0.5) {
            vec2 uv = FragUV;
            if (isFlame > 0.5) {
                uv.y += sin(uTime * 8.0 + FragUV.x * 5.0) * 0.03;
                uv.x += cos(uTime * 6.0 + FragUV.y * 4.0) * 0.02;
            }
            vec3 texColor = texture(wallTexture, uv).rgb;
            vec3 pinkMultiplier = vec3(1.0, 0.75, 0.92);
            effectiveDiffuse = texColor * pinkMultiplier;
        }

        float flicker = 1.2 + 0.15 * sin(uTime * 12.0) * sin(uTime * 7.3) * sin(uTime * 3.7);
        vec3 ambient  = lightAmbient  * effectiveDiffuse * flicker;
        vec3 diffuse  = lightDiffuse  * max(dot(norm, lightDir), 0.0) * effectiveDiffuse;
        vec3 specular = lightSpecular * pow(max(dot(viewDir, reflectDir), 0.0), shininess) * matSpecular;
        float attenuation = 1.0 / (constant + linear * dist + quadratic * dist * dist);
        float shadow = ShadowCalculation(FragPos);
        float shadowFactor = shadow * 0.98;
        vec3 baseLighting = (ambient + (1.0 - shadowFactor) * (diffuse + specular)) * attenuation;
        vec3 finalColor = baseLighting + (effectiveDiffuse * proximityBoost * attenuation);
        // Fog based on distance from flame/light
        if (fogEnabled > 0.5) {
            float fogDist = length(FragPos.xy - lightPos.xy);
            float fogFactor = exp(-fogDist * 1.5);
            fogFactor = clamp(fogFactor, 0.0, 1.0);
            finalColor = mix(vec3(0.0), finalColor, fogFactor);
        }
        FragColor = vec4(clamp(finalColor, 0.0, 3.0), 1.0);
    }`;

var shadowVertexShaderSource = `#version 300 es
    layout(location = 0) in vec3 aPos;
    uniform mat4 model;
    uniform mat4 lightSpaceMatrix;
    out vec3 FragPos;
    void main() {
        vec4 worldPos = model * vec4(aPos, 1.0);
        FragPos = worldPos.xyz;
        gl_Position = lightSpaceMatrix * worldPos;
    }`;

var shadowFragmentShaderSource = `#version 300 es
    precision mediump float;
    in vec3 FragPos;
    uniform vec3 lightPos;
    uniform float farPlane;
    void main() {
        float lightDist = length(FragPos - lightPos);
        lightDist = lightDist / farPlane;
        gl_FragDepth = lightDist;
    }`;

// ─── BLOOM SHADERS ────────────────────────────────────────────────

var screenVertexShaderSource = `#version 300 es
    layout(location = 0) in vec2 aPos;
    layout(location = 1) in vec2 aTexCoord;
    out vec2 TexCoords;
    void main() {
        TexCoords = aTexCoord;
        gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

var bloomBrightShaderSource = `#version 300 es
    precision mediump float;
    in vec2 TexCoords;
    uniform sampler2D hdrScene;
    uniform float threshold;
    out vec4 FragColor;
    void main() {
        vec3 color = texture(hdrScene, TexCoords).rgb;
        float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
        // Soft extraction: only bloom pixels that exceed the threshold
        if (brightness > threshold) {
            FragColor = vec4(color * (brightness - threshold), 1.0);
        } else {
            FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    }`;

var bloomBlurShaderSource = `#version 300 es
    precision mediump float;
    in vec2 TexCoords;
    uniform sampler2D image;
    uniform int horizontal;
    out vec4 FragColor;
    void main() {
        float weight[5];
        weight[0] = 0.2270270270;
        weight[1] = 0.1945945946;
        weight[2] = 0.1216216216;
        weight[3] = 0.0540540541;
        weight[4] = 0.0162162162;
        vec2 texOffset = 1.0 / vec2(textureSize(image, 0));
        vec3 result = texture(image, TexCoords).rgb * weight[0];
        for (int i = 1; i < 5; ++i) {
            vec2 offset = (horizontal == 1)
                ? vec2(texOffset.x * float(i), 0.0)
                : vec2(0.0, texOffset.y * float(i));
            result += texture(image, TexCoords + offset).rgb * weight[i];
            result += texture(image, TexCoords - offset).rgb * weight[i];
        }
        FragColor = vec4(result, 1.0);
    }`;

var bloomCompositeShaderSource = `#version 300 es
    precision mediump float;
    in vec2 TexCoords;
    uniform sampler2D hdrScene;
    uniform sampler2D bloomBlur;
    uniform float bloomStrength;
    out vec4 FragColor;
    void main() {
        vec3 hdrColor   = texture(hdrScene, TexCoords).rgb;
        vec3 bloomColor = texture(bloomBlur, TexCoords).rgb;
        vec3 result = hdrColor + bloomColor * bloomStrength;
        
        if (bloomStrength < 0.01) {
            // Dark phase: just gamma correct + black crush
            result = pow(clamp(result, 0.0, 1.0), vec3(1.0 / 2.2));
            result = max(result - vec3(0.04), vec3(0.0));
        } else {
            // Lit phase: ACES tonemapping + pink tint + gamma
            result = (result * (2.51 * result + 0.03)) / (result * (2.43 * result + 0.59) + 0.14);
            result = mix(result, result * vec3(1.05, 0.92, 1.02), 0.25);
            result = pow(clamp(result, 0.0, 1.0), vec3(1.0 / 2.2));
            result = max(result - vec3(0.02), vec3(0.0));
        }
        FragColor = vec4(result, 1.0);
    }`;


// ─── WATER DROP ───────────────────────────────────────────────────

class WaterDrop {
    constructor(x, spawnY, floorY, phase = Math.random()) {
        this.x       = x;
        this.spawnY  = spawnY;
        this.floorY  = floorY;
        this.radius  = 0.035;
        this.radiusY = 0.4;
        this.y       = floorY + phase * (spawnY - floorY);
        this.velocityY = 0.0;
    }

    update(deltaTime, gravity, game) {
        this.velocityY += gravity * deltaTime;
        this.y += this.velocityY * deltaTime;
        if (this.y <= this.floorY || game.isWall(this.x, this.y)) this.reset();
    }

    reset() {
        this.y = this.spawnY;
        this.velocityY = 0.0;
    }
}


// ─── GAME ─────────────────────────────────────────────────────────

class Game {
    constructor() {
        this.velocityY = 0;
        this.velocityX = 0;
        this.gravity   = -18.0;
        this.jumpForce = 6.5;
        this.grounded  = false;
        this.lampLit   = false;
        this.wasUpPressed = false;

        this.gameState        = 'title';
        this._masterVolume    = 0.8;
        this._autoHopTimer    = 0;
        this._autoHopDir      = 1;
        this._autoHopInterval = 0.7;
        this._sequentialCount = 0;
        

        this.titleMaze = [
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
            [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            [1,0,0,0,0,0,1,1,1,0,0,0,1,1,1,0,0,0,0,0,1],
            [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            [1,0,0,1,1,1,0,0,0,0,0,0,0,0,0,1,1,1,0,0,1],
            [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            [1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1],
            [1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1],
            [1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        ];

        this.canvas = document.getElementById('gl-canvas');
        this.canvas.style.width  = "100%";
        this.canvas.style.height = "100%";
        this.canvas.width  = this.canvas.clientWidth  * window.devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;

        this.gl = this.canvas.getContext('webgl2');
        if (!this.gl) { alert('WebGL2 not supported!'); return; }

        this.cellSize   = 0.4;
        this.keys       = {};
        this.previousTime = 0;
        this.flameHW    = this.cellSize * 0.22;
        this.flameHH    = this.cellSize * 0.22;
        this.flameSpeed = 4.0;
        this.currentLevelIndex = 0;

        this.levels = [
            // Level 1
            [
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,1],
                [1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1],
                [1,0,4,0,0,0,0,0,1,1,1,1,0,0,1,1,1,1,1,1,1],
                [1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,1],
                [1,2,0,0,1,1,1,1,1,0,0,0,0,1,1,1,1,1,1,1,1],
                [1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,0,0,1,1,1,1,1,1,1,0,0,4,0,0,0,0,0,1],
                [1,1,1,1,0,0,0,0,4,0,0,0,0,0,0,0,0,0,4,0,1],
                [1,1,1,1,1,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,1],
                [1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
            ],
            // Level 2
            [
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,1,1,1,0,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,1],
                [1,0,0,0,0,0,0,4,0,0,0,0,0,0,0,4,0,0,0,0,1],
                [1,0,0,0,1,1,1,1,1,0,3,1,1,0,0,1,1,0,0,0,1],
                [1,1,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,1,1,1],
                [1,0,0,1,1,0,0,1,1,0,0,1,1,1,1,0,0,0,0,0,1],
                [1,0,0,1,0,0,0,0,4,0,0,0,0,0,0,0,0,1,0,0,1],
                [1,0,1,1,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1],
                [1,0,0,1,1,0,0,0,0,0,0,0,0,0,4,0,1,1,0,0,1],
                [1,1,0,1,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,1,1],
                [1,2,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
            ],
            // Level 3
            [
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
                [1,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1],
                [1,0,0,0,0,0,1,1,1,0,1,1,1,0,0,0,0,0,1,1,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,1,1,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
                [1,2,0,4,0,0,4,0,0,4,0,0,4,0,0,4,0,0,4,0,1],
                [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
            ]
        ];

        this.waterHazards     = [];
        this.audioCtx         = null;
        this.pannerNode       = null;
        this.audioInitialized = false;

        this.model            = glMatrix.mat4.create();
        this.view             = glMatrix.mat4.create();
        this.projection       = glMatrix.mat4.create();

        this.mazeShader         = new Shader(this.gl, vertexShaderSource, fragmentShaderSource);
        this.shadowShader       = new Shader(this.gl, shadowVertexShaderSource, shadowFragmentShaderSource);
        this.bloomBrightShader  = new Shader(this.gl, screenVertexShaderSource, bloomBrightShaderSource);
        this.bloomBlurShader    = new Shader(this.gl, screenVertexShaderSource, bloomBlurShaderSource);
        this.bloomCompositeShader = new Shader(this.gl, screenVertexShaderSource, bloomCompositeShaderSource);

        this.createUI();
        this.initWebGL();
        this.initBloom();
        this.loadTitleScreen();
        this.setupEventListeners();

        requestAnimationFrame((now) => this.render(now));
    }

    // ─── UI ───────────────────────────────────────────────────────

    createUI() {
        const style = document.createElement('style');
        style.textContent = `
            body { margin:0; background:#050104; overflow:hidden; font-family:sans-serif; }
            #title-screen {
                position:absolute; top:0; left:0; width:100%; height:100%;
                display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                z-index:5; pointer-events:none;
                background: rgba(5, 1, 4, 0.3);
            }
            #title-name {
                font-family:Georgia,serif; font-size:72px; color:#ffb6c1;
                text-shadow:0 0 30px rgba(255,20,147,0.9),0 0 60px rgba(255,105,180,0.5);
                letter-spacing:6px; pointer-events:none; font-weight:bold;
            }
            #title-sub {
                color:#f4b2da; font-size:16px; letter-spacing:2px; font-style:italic;
                text-shadow:0 0 10px rgba(255,20,147,0.4); margin-top:8px;
            }
            #title-start-btn {
                margin-top:48px; pointer-events:all;
                background:rgba(255,20,147,0.85); border:2px solid #fff;
                color:white; padding:12px 36px; font-size:20px;
                font-weight:bold; border-radius:30px; cursor:pointer;
                box-shadow:0 0 20px rgba(255,20,147,0.6); transition: 0.2s;
            }
            #title-start-btn:hover {
                background:rgba(255,105,180,0.95);
                box-shadow:0 0 30px rgba(255,105,180,0.8);
            }
            #next-level-btn {
                position:absolute; bottom:30px; left:50%;
                transform:translateX(-50%); display:none;
                background:rgba(255,20,147,0.85); border:2px solid #fff;
                color:white; padding:12px 24px; font-size:18px;
                font-weight:bold; border-radius:30px; cursor:pointer;
                box-shadow:0 0 15px rgba(255,20,147,0.6); z-index:10;
            }
            #menu-btn {
                position:absolute; top:20px; right:20px; z-index:10;
                background:rgba(25,8,20,0.8); border:2px solid #ff69b4;
                color:#ffb6c1; font-size:24px; width:48px; height:48px; border-radius:50%;
                cursor:pointer; display:flex; align-items:center; justify-content:center;
            }
            #menu-overlay, #instructions-overlay, #victory-overlay {
                position:absolute; top:0; left:0; width:100%; height:100%;
                background:rgba(5,2,5,0.8); display:none; flex-direction:column;
                align-items:center; justify-content:center; z-index:8;
            }
            #menu-overlay.open, #instructions-overlay.open, #victory-overlay.open { display:flex; }
            .menu-card, #instructions-card, #victory-card {
                background:rgba(25,8,20,0.95); border:2px solid #ff69b4;
                padding:24px; border-radius:12px; width:320px; text-align:center; color:#fff;
            }
            #instructions-card { width:460px; text-align:left; }
            .menu-label, .instr-title, #victory-title {
                font-size:20px; font-weight:bold; color:#ffb6c1; margin-bottom:12px;
                text-shadow:0 0 10px rgba(255,20,147,0.4);
            }
            .menu-row { display:flex; gap:8px; justify-content:center; margin-top:5px; }
            .level-btn {
                background:rgba(45,15,35,0.7); border:1px solid #ff69b4; color:#f4b2da;
                padding:8px 12px; border-radius:6px; cursor:pointer; flex:1;
            }
            .level-btn.active { background:#ff2a85; color:#fff; box-shadow:0 0 10px #ff2a85; }
            .action-btn, #instructions-close-btn, .victory-btn {
                background:rgba(255,20,147,0.2); border:1px solid #ff69b4; color:#ffb6c1;
                padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold;
            }
            .action-btn:hover, #instructions-close-btn:hover, .victory-btn:hover { background:#ff2a85; color:#fff; }
            #instructions-close-btn { width:100%; margin-top:15px; }
            #volume-slider { width:100%; accent-color:#ff2a85; }
        `;
        document.head.appendChild(style);
    }

    // ─── TEXTURE ─────────────────────────────────────────────────

    loadTexture(url) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([255, 255, 255, 255]));
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            console.log('Texture loaded:', url);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        };
        image.onerror = () => console.error('Texture failed to load:', url);
        image.src = url;
        return texture;
    }

    // ─── LEVEL LOADING ────────────────────────────────────────────

    loadLevel(index) {
        this.maze         = this.levels[index];
        this.waterHazards = [];
        this.lampLit      = false;
        this.checkpoints  = [];

        document.getElementById('next-level-btn').style.display = 'none';
        document.getElementById('menu-btn').style.display       = 'block';
        document.querySelectorAll('.level-btn').forEach(b =>
            b.classList.toggle('active', parseInt(b.dataset.level) === index)
        );

        for (let r = 0; r < this.maze.length; r++) {
            for (let c = 0; c < this.maze[r].length; c++) {
                const r_world = this.maze.length - 1 - r;
                const worldX  = (c + 0.5) * this.cellSize;
                const worldY  = (r_world + 0.5) * this.cellSize;

                if (this.maze[r][c] === 2)
                    this.flamePos = glMatrix.vec3.fromValues(worldX, worldY, 0.0);
                if (this.maze[r][c] === 3)
                    this.lampPos  = glMatrix.vec3.fromValues(worldX, worldY, 0.0);

                if (this.maze[r][c] === 4) {
                    let ceilRow = r - 1;
                    while (ceilRow >= 0 && this.maze[ceilRow][c] !== 1) ceilRow--;
                    if (ceilRow < 0) continue;
                    const ceilR_world    = this.maze.length - 1 - ceilRow;
                    const ceilingBottomY = ceilR_world * this.cellSize;
                    let floorRow = r + 1;
                    while (floorRow < this.maze.length && this.maze[floorRow][c] !== 1) floorRow++;
                    let floorTopY = 0;
                    if (floorRow < this.maze.length) {
                        const floorR_world = this.maze.length - 1 - floorRow;
                        floorTopY = (floorR_world + 1) * this.cellSize;
                    }
                    const fallDistance = (ceilingBottomY - 0.01) - floorTopY;
                    const dropCount    = Math.max(2, Math.ceil(fallDistance / (this.flameHH * 2)));
                    for (let i = 0; i < dropCount; i++)
                        this.waterHazards.push(new WaterDrop(worldX, ceilingBottomY - 0.01, floorTopY, i / dropCount));
                }

                if (this.maze[r][c] === 5)
                    this.checkpoints.push({ x: worldX, y: worldY, activated: false });
            }
        }

        this.spawnX = this.flamePos[0];
        this.spawnY = this.flamePos[1];
        this.resetToSpawn();
    }

    loadNextLevel() {
        this._sequentialCount++;
        this.currentLevelIndex++;

        if (this.currentLevelIndex >= this.levels.length) {
            if (this._sequentialCount >= this.levels.length) {
                this.gameState = 'paused';
                document.getElementById('next-level-btn').style.display = 'none';
                document.getElementById('victory-overlay').classList.add('open');
            } else {
                this._sequentialCount = 0;
                this.currentLevelIndex = 0;
                this.loadTitleScreen();
            }
            return;
        }
        this.loadLevel(this.currentLevelIndex);
    }

    loadTitleScreen() {
        this.gameState    = 'title';
        this.maze         = this.titleMaze;
        this.waterHazards = [];
        this.checkpoints  = [];
        this.lampLit      = false;
        this.lampPos      = null;
        this._waterProximity = 0;

        for (let r = 0; r < this.maze.length; r++)
            for (let c = 0; c < this.maze[r].length; c++)
                if (this.maze[r][c] === 2) {
                    const r_world = this.maze.length - 1 - r;
                    this.flamePos = glMatrix.vec3.fromValues(
                        (c + 0.5) * this.cellSize, (r_world + 0.5) * this.cellSize, 0.0);
                }

        this.spawnX = this.flamePos[0];
        this.spawnY = this.flamePos[1];
        this.velocityX = 0; this.velocityY = 0; this.grounded = false;
        this._autoHopTimer    = 0;
        this._autoHopDir      = 1;
        this._autoHopInterval = 0.6 + Math.random();

        document.getElementById('title-screen').style.display   = 'flex';
        document.getElementById('menu-btn').style.display       = 'none';
        document.getElementById('menu-overlay').classList.remove('open');
        document.getElementById('instructions-overlay').classList.remove('open');
        document.getElementById('victory-overlay').classList.remove('open');
        document.getElementById('next-level-btn').style.display = 'none';
    }

    // ─── COLLISION ────────────────────────────────────────────────

    isWall(worldX, worldY) {
        const c       = Math.floor(worldX / this.cellSize);
        const r_world = Math.floor(worldY / this.cellSize);
        const r       = this.maze.length - 1 - r_world;
        if (r < 0 || r >= this.maze.length || c < 0 || c >= this.maze[0].length) return true;
        return this.maze[r][c] === 1;
    }

    isBlocked(x, y) {
        const e = 0.0005;
        return this.isWall(x - this.flameHW + e, y - this.flameHH + e) ||
               this.isWall(x + this.flameHW - e, y - this.flameHH + e) ||
               this.isWall(x - this.flameHW + e, y + this.flameHH - e) ||
               this.isWall(x + this.flameHW - e, y + this.flameHH - e);
    }

    checkLampTrigger() {
        if (this.lampLit || !this.lampPos) return;
        const dx = Math.abs(this.flamePos[0] - this.lampPos[0]);
        const dy = Math.abs(this.flamePos[1] - this.lampPos[1]);
        if (dx < this.cellSize * 0.5 && dy < this.cellSize * 0.5) {
            this.lampLit = true;
            document.getElementById('next-level-btn').style.display = 'block';
        }
    }

    checkCheckpointTrigger() {
        if (!this.checkpoints) return;
        this.checkpoints.forEach(cp => {
            if (cp.activated) return;
            const dx = Math.abs(this.flamePos[0] - cp.x);
            const dy = Math.abs(this.flamePos[1] - cp.y);
            if (dx < this.cellSize * 0.6 && dy < this.cellSize * 0.6) {
                cp.activated = true;
                this.spawnX  = cp.x;
                this.spawnY  = cp.y;
            }
        });
    }

    checkWaterCollisions() {
        for (let i = 0; i < this.waterHazards.length; i++) {
            const drop = this.waterHazards[i];
            const dx   = this.flamePos[0] - drop.x;
            const dy   = this.flamePos[1] - drop.y;
            const rx   = drop.radius  + this.flameHW;
            const ry   = drop.radiusY + this.flameHH;
            if ((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) < 1.0) {
                this.resetToSpawn();
                drop.reset();
                break;
            }
        }
    }

    resetToSpawn() {
        this.flamePos[0]  = this.spawnX;
        this.flamePos[1]  = this.spawnY;
        this.velocityY    = 0;
        this.velocityX    = 0;
        this.grounded     = false;
        this.wasUpPressed = false;
    }

    // ─── MOVEMENT ────────────────────────────────────────────────

    processMovement(deltaTime) {
        if (this.gameState === 'paused') return;

        const cs = this.cellSize;
        let targetVelocityX = 0;

        if (this.gameState === 'title') {
            this._autoHopTimer += deltaTime;
            if (this._autoHopTimer >= this._autoHopInterval) {
                this._autoHopTimer    = 0;
                this._autoHopInterval = 0.4 + Math.random() * 1.0;
                if (this.grounded && !this.keys['ArrowUp'] && !this.keys['ArrowLeft'] && !this.keys['ArrowRight']) {
                    this.velocityY = this.jumpForce * (0.55 + Math.random() * 0.45);
                    this.grounded  = false;
                }
                if (!this.keys['ArrowLeft'] && !this.keys['ArrowRight'])
                    if (Math.random() > 0.35) this._autoHopDir *= -1;
            }
            if      (this.keys['ArrowLeft'])  targetVelocityX = -this.flameSpeed;
            else if (this.keys['ArrowRight']) targetVelocityX =  this.flameSpeed;
            else                              targetVelocityX =  this._autoHopDir * this.flameSpeed * 0.55;
            if (this.keys['ArrowUp'] && !this.wasUpPressed && this.grounded) {
                this.wasUpPressed = true;
                this.velocityY    = this.jumpForce;
                this.grounded     = false;
            } else if (!this.keys['ArrowUp']) {
                this.wasUpPressed = false;
            }
        } else {
            if (this.keys['ArrowLeft'])  targetVelocityX -= this.flameSpeed;
            if (this.keys['ArrowRight']) targetVelocityX += this.flameSpeed;
        }

        this.velocityX += (targetVelocityX - this.velocityX) * Math.min(1.0, deltaTime * 12.0);

        if (!this.grounded) {
            this.velocityY += this.gravity * deltaTime;
        } else {
            this.velocityY = 0;
            const belowY  = this.flamePos[1] - this.flameHH - 0.002;
            const leftOk  = this.isWall(this.flamePos[0] - this.flameHW + 0.001, belowY);
            const rightOk = this.isWall(this.flamePos[0] + this.flameHW - 0.001, belowY);
            if (!leftOk && !rightOk) this.grounded = false;
        }

        const wallOffset    = 0.01;
        const touchingLeft  = this.isWall(this.flamePos[0] - this.flameHW - wallOffset, this.flamePos[1]);
        const touchingRight = this.isWall(this.flamePos[0] + this.flameHW + wallOffset, this.flamePos[1]);

        if (this.gameState === 'playing') {
            if (this.keys['ArrowUp']) {
                if (!this.wasUpPressed) {
                    this.wasUpPressed = true;
                    if (this.grounded) {
                        this.velocityY = this.jumpForce;
                        this.grounded  = false;
                    } else if (touchingLeft || touchingRight) {
                        this.velocityY = this.jumpForce * 0.95;
                        this.velocityX = touchingLeft ? this.flameSpeed * 1.5 : -this.flameSpeed * 1.5;
                    }
                }
            } else {
                this.wasUpPressed = false;
            }
        }

        const dx = this.velocityX * deltaTime;
        const dy = this.velocityY * deltaTime;

        if (dx !== 0) {
            const newX = this.flamePos[0] + dx;
            if (!this.isBlocked(newX, this.flamePos[1])) {
                this.flamePos[0] = newX;
            } else {
                this.velocityX = 0;
                if (this.gameState === 'title') this._autoHopDir *= -1;
                if (dx > 0) {
                    const wallC = Math.floor((this.flamePos[0] + this.flameHW + this.flameSpeed * deltaTime) / cs);
                    this.flamePos[0] = wallC * cs - this.flameHW - 0.001;
                } else {
                    const wallC = Math.floor((this.flamePos[0] - this.flameHW - this.flameSpeed * deltaTime) / cs) + 1;
                    this.flamePos[0] = wallC * cs + this.flameHW + 0.001;
                }
            }
        }

        if (dy !== 0) {
            const newY = this.flamePos[1] + dy;
            if (!this.isBlocked(this.flamePos[0], newY)) {
                this.flamePos[1] = newY;
            } else if (dy < 0) {
                const bottomEdge = this.flamePos[1] + dy - this.flameHH;
                const floorRow   = Math.floor(bottomEdge / cs);
                this.flamePos[1] = (floorRow + 1) * cs + this.flameHH + 0.001;
                this.velocityY   = 0;
                this.grounded    = true;
            } else {
                const topEdge    = this.flamePos[1] + dy + this.flameHH;
                const ceilRow    = Math.floor(topEdge / cs);
                this.flamePos[1] = ceilRow * cs - this.flameHH - 0.001;
                this.velocityY   = 0;
            }
        }

        if (this.gameState === 'playing') {
            this.waterHazards.forEach(drop => drop.update(deltaTime, this.gravity * 0.35, this));
            this.checkWaterCollisions();
            this.updateSpatialAudio();
        }
    }

    // ─── AUDIO ───────────────────────────────────────────────────

    initSpatialAudio() {
        if (this.audioInitialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
            const unlock = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate);
            const src    = this.audioCtx.createBufferSource();
            src.buffer   = unlock;
            src.connect(this.audioCtx.destination);
            src.start(0);
            this.audioCtx.resume();
            this.audioCtx.onstatechange = () => {
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            };
            this.pannerNode = this.audioCtx.createStereoPanner?.() ?? null;
            this.gainNode   = this.audioCtx.createGain();
            this.gainNode.gain.setValueAtTime(0.0, this.audioCtx.currentTime);
            if (this.pannerNode) {
                this.gainNode.connect(this.pannerNode);
                this.pannerNode.connect(this.audioCtx.destination);
            } else {
                this.gainNode.connect(this.audioCtx.destination);
            }
            this.playProceduralDripLoop();
            this.audioInitialized = true;
            if (navigator.mediaDevices && !this._deviceChangeListenerAdded) {
                this._deviceChangeListenerAdded = true;
                navigator.mediaDevices.addEventListener('devicechange', () => this._restartAudio());
            }
        } catch(e) { console.error("Audio failure:", e); }
    }

    playProceduralDripLoop() {
        fetch('water_drop.mp3')
            .then(res => res.arrayBuffer())
            .then(buf => this.audioCtx.decodeAudioData(buf))
            .then(decoded => {
                this._dripBuffer = decoded;
                this._scheduleDrip();
            })
            .catch(e => console.error('Failed to load water_drop.mp3:', e));
    }

    _scheduleDrip() {
        const scheduleNext = () => {
            if (!this.audioCtx || this.audioCtx.state === 'suspended') {
                setTimeout(scheduleNext, 600); return;
            }
            const proximity = this._waterProximity || 0;
            if (proximity > 0.005 && this._dripBuffer) {
                const src = this.audioCtx.createBufferSource();
                src.buffer = this._dripBuffer;
                const nodeGain = this.audioCtx.createGain();
                const vol = proximity * this._masterVolume * (1.5 + Math.random() * 0.5);
                nodeGain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
                src.connect(nodeGain);
                if (this.pannerNode) nodeGain.connect(this.pannerNode);
                else nodeGain.connect(this.audioCtx.destination);
                src.start();
            }
            const interval = 120 + (1 - (this._waterProximity || 0)) * 1100 + Math.random() * 120;
            setTimeout(scheduleNext, interval);
        };
        scheduleNext();
    }

    updateSpatialAudio() {
        if (!this.audioInitialized || !this.gainNode) return;
        let pX = this.flamePos[0], pY = this.flamePos[1];
        let closestDrop = null, minDistance = Infinity;
        this.waterHazards.forEach(drop => {
            const d = Math.sqrt((pX - drop.x) ** 2 + (pY - drop.y) ** 2);
            if (d < minDistance) { minDistance = d; closestDrop = drop; }
        });
        const minDist   = 0.8;
        const maxRadius = 4.0;
        let volume = 0.0;
        if (minDistance < maxRadius) {
            const clamped = Math.max(minDistance, minDist);
            volume = Math.min(1.0, (minDist / clamped) ** 2);
            const fadeEdge = 0.8;
            if (minDistance > maxRadius * fadeEdge)
                volume *= 1.0 - (minDistance - maxRadius * fadeEdge) / (maxRadius * (1.0 - fadeEdge));
        }
        this._waterProximity = volume;
        this.gainNode.gain.setTargetAtTime(volume, this.audioCtx.currentTime, 0.04);
        if (this.pannerNode && closestDrop) {
            const pan = Math.max(-1, Math.min(1, (closestDrop.x - pX) / maxRadius));
            this.pannerNode.pan.setTargetAtTime(pan, this.audioCtx.currentTime, 0.04);
        }
    }

    _restartAudio() {
        if (!this.audioInitialized) return;
        this._dripLoopId = (this._dripLoopId || 0) + 1;
        const old = this.audioCtx;
        this.audioInitialized = false;
        this.gainNode   = null;
        this.pannerNode = null;
        old.close()
            .then(() => this.initSpatialAudio())
            .catch(() => this.initSpatialAudio());
    }

    // ─── SPHERE ──────────────────────────────────────────────────

    createSphereVAO() {
        const gl = this.gl;
        const stacks = 32, slices = 32;
        const verts = [];

        for (let i = 0; i < stacks; i++) {
            for (let j = 0; j < slices; j++) {
                const corners = [[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
                const pts = corners.map(([si, sj]) => {
                    const phi   = Math.PI * si / stacks;
                    const theta = 2 * Math.PI * sj / slices;
                    const nx = Math.sin(phi) * Math.cos(theta);
                    const ny = Math.cos(phi);
                    const nz = Math.sin(phi) * Math.sin(theta);
                    return [0.5*nx, 0.5*ny, 0.5*nz, nx, ny, nz, sj/slices, si/stacks];
                });
                for (const idx of [0,1,2, 0,2,3])
                    verts.push(...pts[idx]);
            }
        }

        const vertices = new Float32Array(verts);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        const F = Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 8*F, 0);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 8*F, 3*F);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8*F, 6*F);
        gl.enableVertexAttribArray(2);
        gl.bindVertexArray(null);
        this.sphereVertexCount = stacks * slices * 6;
        return vao;
    }

    // ─── WEBGL INIT ──────────────────────────────────────────────

    initWebGL() {
        const gl = this.gl;
        this.farPlane = 3.0;

        const vertices = new Float32Array([
            -0.5,-0.5,-0.5, 0,0,-1, 0,0,
             0.5,-0.5,-0.5, 0,0,-1, 1,0,
             0.5, 0.5,-0.5, 0,0,-1, 1,1,
             0.5, 0.5,-0.5, 0,0,-1, 1,1,
            -0.5, 0.5,-0.5, 0,0,-1, 0,1,
            -0.5,-0.5,-0.5, 0,0,-1, 0,0,
            -0.5,-0.5, 0.5, 0,0,1, 0,0,
             0.5,-0.5, 0.5, 0,0,1, 1,0,
             0.5, 0.5, 0.5, 0,0,1, 1,1,
             0.5, 0.5, 0.5, 0,0,1, 1,1,
            -0.5, 0.5, 0.5, 0,0,1, 0,1,
            -0.5,-0.5, 0.5, 0,0,1, 0,0,
            -0.5, 0.5, 0.5, -1,0,0, 1,1,
            -0.5, 0.5,-0.5, -1,0,0, 0,1,
            -0.5,-0.5,-0.5, -1,0,0, 0,0,
            -0.5,-0.5,-0.5, -1,0,0, 0,0,
            -0.5,-0.5, 0.5, -1,0,0, 1,0,
            -0.5, 0.5, 0.5, -1,0,0, 1,1,
             0.5, 0.5, 0.5, 1,0,0, 1,1,
             0.5, 0.5,-0.5, 1,0,0, 0,1,
             0.5,-0.5,-0.5, 1,0,0, 0,0,
             0.5,-0.5,-0.5, 1,0,0, 0,0,
             0.5,-0.5, 0.5, 1,0,0, 1,0,
             0.5, 0.5, 0.5, 1,0,0, 1,1,
            -0.5,-0.5,-0.5, 0,-1,0, 0,0,
             0.5,-0.5,-0.5, 0,-1,0, 1,0,
             0.5,-0.5, 0.5, 0,-1,0, 1,1,
             0.5,-0.5, 0.5, 0,-1,0, 1,1,
            -0.5,-0.5, 0.5, 0,-1,0, 0,1,
            -0.5,-0.5,-0.5, 0,-1,0, 0,0,
            -0.5, 0.5,-0.5, 0,1,0, 0,0,
             0.5, 0.5,-0.5, 0,1,0, 1,0,
             0.5, 0.5, 0.5, 0,1,0, 1,1,
             0.5, 0.5, 0.5, 0,1,0, 1,1,
            -0.5, 0.5, 0.5, 0,1,0, 0,1,
            -0.5, 0.5,-0.5, 0,1,0, 0,0,
        ]);
        this.cubeVertexCount = 36;

        this.cubeVAO = gl.createVertexArray();
        gl.bindVertexArray(this.cubeVAO);
        const VBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, VBO);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        const F = Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 8*F, 0);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 8*F, 3*F);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8*F, 6*F);
        gl.enableVertexAttribArray(2);
        gl.bindVertexArray(null);

        this.sphereVAO = this.createSphereVAO();

        this.SHADOW_WIDTH = 2048; this.SHADOW_HEIGHT = 2048;
        this.depthMapFBO  = gl.createFramebuffer();
        this.depthCubeMap = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.depthCubeMap);
        for (let i = 0; i < 6; i++) {
            gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.DEPTH_COMPONENT24,
                this.SHADOW_WIDTH, this.SHADOW_HEIGHT, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        }
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthMapFBO);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.wallTexture       = this.loadTexture('brick_pavement_03_diff_4k.jpg');
        this.flameTexture      = this.loadTexture('flame.png');
        this.lampTexture       = this.loadTexture('lamp.png');
        this.dropTexture       = this.loadTexture('dark_water.jpg');
        this.checkpointTexture = this.loadTexture('diamond.png');

        this.mazeShader.use();
        this.mazeShader.setFloat('farPlane', 3.0);
        this.mazeShader.setVec3('matDiffuse',  0.5, 0.5, 0.5);
        this.mazeShader.setVec3('matSpecular', 0.2, 0.2, 0.2);
        this.mazeShader.setFloat('shininess',  32.0);
        this.mazeShader.setFloat('constant',   1.0);
        this.mazeShader.setFloat('linear',     1.5);
        this.mazeShader.setFloat('quadratic',  2.5);
        this.mazeShader.setFloat('proximityBoost', 0.0);
        this.mazeShader.setFloat('useTexture', 0.0);
        this.mazeShader.setInt('wallTexture',  1);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
    }

    // ─── BLOOM INIT ──────────────────────────────────────────────

    initBloom() {
        const gl = this.gl;
        
        // 1. CRITICAL FBO FIX: Request linear filtering for HDR textures!
        gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');
        gl.getExtension('OES_texture_half_float_linear'); 

        const w = this.canvas.width, h = this.canvas.height;

        // HDR framebuffer — scene renders here
        this.hdrFBO      = gl.createFramebuffer();
        this.hdrColorTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.hdrColorTex);
        
        // 2. Switched gl.FLOAT to gl.HALF_FLOAT for stable linear filtering
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const hdrDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, hdrDepth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hdrColorTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, hdrDepth);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Ping-pong framebuffers for Gaussian blur
        this.pingpongFBO = [gl.createFramebuffer(), gl.createFramebuffer()];
        this.pingpongTex = [gl.createTexture(), gl.createTexture()];
        for (let i = 0; i < 2; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.pingpongTex[i]);
            // Apply gl.HALF_FLOAT to the ping-pong targets as well
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingpongFBO[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pingpongTex[i], 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Screen quad VAO (pos2D + UV2D)
        const quadVerts = new Float32Array([
            -1, -1,  0, 0,   1, -1,  1, 0,   1,  1,  1, 1,
            -1, -1,  0, 0,   1,  1,  1, 1,  -1,  1,  0, 1,
        ]);
        this.screenQuadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.screenQuadVAO);
        const quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
        const F = Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4*F, 0);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4*F, 2*F);
        gl.enableVertexAttribArray(1);
        gl.bindVertexArray(null);
    }

    // ─── RENDER ──────────────────────────────────────────────────

    render(timestamp) {
        const gl          = this.gl;
        const currentTime = timestamp / 1000.0;
        const deltaTime   = Math.min(currentTime - this.previousTime, 0.05);
        this.previousTime = currentTime;

        this.processMovement(deltaTime);
        if (this.gameState === 'playing') {
            this.checkCheckpointTrigger();
            this.checkLampTrigger();
        }

        // ── Pass 1: Omnidirectional shadow map ────────────────────────
        const lightPos = [this.flamePos[0], this.flamePos[1], 0.25];
        const farPlane = 3.0;

        this.lightProjection = glMatrix.mat4.create();
        glMatrix.mat4.perspective(this.lightProjection, glMatrix.glMatrix.toRadian(90.0), 1.0, 0.05, farPlane);

        const lp = glMatrix.vec3.fromValues(lightPos[0], lightPos[1], lightPos[2]);

        const shadowTransforms = [];
        const dirs = [
            { target: [lightPos[0]+1, lightPos[1],   lightPos[2]],   up: [0,-1, 0] },
            { target: [lightPos[0]-1, lightPos[1],   lightPos[2]],   up: [0,-1, 0] },
            { target: [lightPos[0],   lightPos[1]+1, lightPos[2]],   up: [0, 0, 1] },
            { target: [lightPos[0],   lightPos[1]-1, lightPos[2]],   up: [0, 0,-1] },
            { target: [lightPos[0],   lightPos[1],   lightPos[2]+1], up: [0,-1, 0] },
            { target: [lightPos[0],   lightPos[1],   lightPos[2]-1], up: [0,-1, 0] },
        ];

        for (const d of dirs) {
            const m = glMatrix.mat4.create();
            glMatrix.mat4.lookAt(m,
                glMatrix.vec3.fromValues(lightPos[0], lightPos[1], lightPos[2]),
                glMatrix.vec3.fromValues(d.target[0], d.target[1], d.target[2]),
                glMatrix.vec3.fromValues(d.up[0], d.up[1], d.up[2])
            );
            shadowTransforms.push(m);
}

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthMapFBO);
        gl.viewport(0, 0, this.SHADOW_WIDTH, this.SHADOW_HEIGHT);
        this.shadowShader.use();
        this.shadowShader.setVec3('lightPos', lightPos[0], lightPos[1], lightPos[2]);
        this.shadowShader.setFloat('farPlane', farPlane);

        for (let face = 0; face < 6; face++) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, this.depthCubeMap, 0);
            gl.clear(gl.DEPTH_BUFFER_BIT);

            const lightSpaceMatrix = glMatrix.mat4.create();
            glMatrix.mat4.multiply(lightSpaceMatrix, this.lightProjection, shadowTransforms[face]);
            this.shadowShader.setMat4('lightSpaceMatrix', lightSpaceMatrix);

            gl.bindVertexArray(this.cubeVAO);
            for (let r = 0; r < this.maze.length; r++)
                for (let c = 0; c < this.maze[r].length; c++)
                    if (this.maze[r][c] === 1) {
                        const rw = this.maze.length - 1 - r;
                        glMatrix.mat4.identity(this.model);
                        glMatrix.mat4.translate(this.model, this.model,
                            [(c+0.5)*this.cellSize, (rw+0.5)*this.cellSize, 0]);
                        glMatrix.mat4.scale(this.model, this.model,
                            [this.cellSize, this.cellSize, this.cellSize]);
                        this.shadowShader.setMat4('model', this.model);
                        gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
                    }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // ── Pass 2: Scene → HDR framebuffer ──────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFBO);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.enable(gl.DEPTH_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const centerX = (21 * this.cellSize) / 2;
        const centerY = (12 * this.cellSize) / 2;
        glMatrix.mat4.lookAt(this.view, [centerX,centerY,5.2], [centerX,centerY,-0.2], [0,1,0]);
        glMatrix.mat4.perspective(this.projection, glMatrix.glMatrix.toRadian(45.0),
            this.canvas.width / this.canvas.height, 0.1, 100.0);

        this.mazeShader.use();
        this.mazeShader.setMat4('projection', this.projection);
        this.mazeShader.setMat4('view',       this.view);
        this.mazeShader.setVec3('viewPos',    centerX, centerY, 5.2);
        this.mazeShader.setVec3('lightPos',   this.flamePos[0], this.flamePos[1], 0.25);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.depthCubeMap);
        this.mazeShader.setInt('shadowMap', 0);

        if (this.lampLit || this.gameState === 'title') {
            this.mazeShader.setVec3('lightAmbient',  0.5,  0.35, 0.5);
            this.mazeShader.setVec3('lightDiffuse',  0.4,  0.2, 0.25);
            this.mazeShader.setVec3('lightSpecular', 0.4,  0.3, 0.35);
            this.mazeShader.setFloat('constant',  1.0);
            this.mazeShader.setFloat('linear',    0.02);
            this.mazeShader.setFloat('quadratic', 0.01);
            this.mazeShader.setFloat('fogEnabled', 0.0);
        } else {
            this.mazeShader.setVec3('lightAmbient',  0.2, 0.1, 0.2);
            this.mazeShader.setVec3('lightDiffuse',  0.01,  0.008,   0.01);
            this.mazeShader.setVec3('lightSpecular', 0.01,  0.007,   0.01);
            this.mazeShader.setFloat('constant',  1.0);
            this.mazeShader.setFloat('linear',    2.0);
            this.mazeShader.setFloat('quadratic', 3.0);
            this.mazeShader.setFloat('fogEnabled', 1.0);
        }

        gl.bindVertexArray(this.cubeVAO);
        this.mazeShader.setFloat('proximityBoost', 0.01);

        // Walls
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.wallTexture);
        this.mazeShader.setInt('wallTexture',  1);
        this.mazeShader.setFloat('useTexture', 1.0);
        this.mazeShader.setVec3('lightAmbient', 0.15, 0.05, 0.15);
        this.mazeShader.setVec3('lightDiffuse',  0.02, 0.01, 0.02);
        this.mazeShader.setVec3('lightSpecular', 0.02, 0.01, 0.02);
        this.mazeShader.setFloat('shininess',  48.0);
        for (let r = 0; r < this.maze.length; r++)
            for (let c = 0; c < this.maze[r].length; c++)
                if (this.maze[r][c] === 1) {
                    const rw = this.maze.length - 1 - r;
                    glMatrix.mat4.identity(this.model);
                    glMatrix.mat4.translate(this.model, this.model,
                        [(c+0.5)*this.cellSize, (rw+0.5)*this.cellSize, 0]);
                    glMatrix.mat4.scale(this.model, this.model,
                        [this.cellSize, this.cellSize, this.cellSize]);
                    this.mazeShader.setMat4('model', this.model);
                    gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
                }
        this.mazeShader.setFloat('useTexture', 0.0);

        // Background
        this.mazeShader.setVec3('lightAmbient', 0.015, 0.01, 0.015);
        this.mazeShader.setVec3('lightDiffuse',  0.02, 0.01, 0.02);
        this.mazeShader.setVec3('lightSpecular', 0.02, 0.01, 0.02);
        this.mazeShader.setFloat('shininess',  32.0);
        for (let r = 0; r < this.maze.length; r++)
            for (let c = 0; c < this.maze[r].length; c++)
                if (this.maze[r][c] !== 1) {
                    const rw = this.maze.length - 1 - r;
                    glMatrix.mat4.identity(this.model);
                    glMatrix.mat4.translate(this.model, this.model,
                        [(c+0.5)*this.cellSize, (rw+0.5)*this.cellSize, -this.cellSize*0.5]);
                    glMatrix.mat4.scale(this.model, this.model, [this.cellSize, this.cellSize, 0.05]);
                    this.mazeShader.setMat4('model', this.model);
                    gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
                }

        // Water hazards
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.dropTexture);
        this.mazeShader.setInt('wallTexture', 1);
        this.waterHazards.forEach(drop => {
            const dist  = Math.sqrt((this.flamePos[0]-drop.x)**2 + (this.flamePos[1]-drop.y)**2);
            const boost = dist < 1.0 ? (1.0 - dist) * 0.1 : 0.0;
            this.mazeShader.setFloat('proximityBoost', boost);

            this.mazeShader.setFloat('useTexture', 1.0);
            this.mazeShader.setVec3('lightAmbient', 0.15, 0.05, 0.15);
            this.mazeShader.setVec3('lightDiffuse',  0.02, 0.01, 0.02);
            this.mazeShader.setVec3('lightSpecular', 0.02, 0.01, 0.02);
            glMatrix.mat4.identity(this.model);
            glMatrix.mat4.translate(this.model, this.model, [drop.x, drop.floorY+0.01, 0.15]);
            glMatrix.mat4.scale(this.model, this.model, [this.cellSize*0.4, 0.015, 0.1]);
            this.mazeShader.setMat4('model', this.model);
            gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);

            this.mazeShader.setFloat('useTexture', 0.0);
            this.mazeShader.setVec3('lightAmbient', 0.15, 0.05, 0.15);
            this.mazeShader.setVec3('lightDiffuse',  0.1, 0.05, 0.1);
            this.mazeShader.setVec3('lightSpecular', 0.02, 0.01, 0.02);
            glMatrix.mat4.identity(this.model);
            glMatrix.mat4.translate(this.model, this.model, [drop.x, drop.spawnY-0.02, 0.15]);
            glMatrix.mat4.scale(this.model, this.model, [this.cellSize*0.45, 0.04, this.cellSize*0.4]);
            this.mazeShader.setMat4('model', this.model);
            gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);

            this.mazeShader.setFloat('useTexture', 1.0);
            this.mazeShader.setVec3('lightAmbient', 0.07, 0.04, 0.07);
            this.mazeShader.setVec3('lightDiffuse',  0.02, 0.01, 0.02);
            this.mazeShader.setVec3('lightSpecular', 0.02, 0.01, 0.02);
            glMatrix.mat4.identity(this.model);
            glMatrix.mat4.translate(this.model, this.model, [drop.x, drop.y, 0.15]);
            glMatrix.mat4.scale(this.model, this.model, [drop.radius*2, drop.radius*3, drop.radius*2]);
            this.mazeShader.setMat4('model', this.model);
            gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
        });
        this.mazeShader.setFloat('proximityBoost', 0.0);
        this.mazeShader.setFloat('useTexture', 0.0);

        // Checkpoints
        if (this.checkpoints) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.checkpointTexture);
            this.mazeShader.setInt('wallTexture', 1);
            this.mazeShader.setFloat('useTexture', 1.0);
            this.checkpoints.forEach(cp => {
                this.mazeShader.setVec3('matDiffuse',
                    cp.activated ? 0.1 : 0.05,
                    cp.activated ? 0.4 : 0.1,
                    1.0);
                glMatrix.mat4.identity(this.model);
                glMatrix.mat4.translate(this.model, this.model, [cp.x, cp.y, 0.15]);
                glMatrix.mat4.scale(this.model, this.model,
                    [this.cellSize*0.3, this.cellSize*0.5, this.cellSize*0.3]);
                this.mazeShader.setMat4('model', this.model);
                gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
            });
            this.mazeShader.setFloat('useTexture', 0.0);
        }

        // Lamp
        if (this.gameState === 'playing' && this.lampPos) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.lampTexture);
            this.mazeShader.setInt('wallTexture', 1);
            this.mazeShader.setFloat('useTexture', 1.0);
            this.mazeShader.setFloat('proximityBoost', 0.2);
            this.mazeShader.setVec3('lightAmbient', 0.0, 0.0, 0.0);
            this.mazeShader.setVec3('lightDiffuse',  0.06, 0.04, 0.06);
            this.mazeShader.setVec3('lightSpecular', 0.04, 0.03, 0.04);
            glMatrix.mat4.identity(this.model);
            glMatrix.mat4.translate(this.model, this.model,
                [this.lampPos[0], this.lampPos[1], this.lampPos[2]]);
            glMatrix.mat4.scale(this.model, this.model,
                [this.cellSize*0.5, this.cellSize*0.5, this.cellSize*0.5]);
            this.mazeShader.setMat4('model', this.model);
            gl.drawArrays(gl.TRIANGLES, 0, this.cubeVertexCount);
            this.mazeShader.setFloat('useTexture', 0.0);
            this.mazeShader.setFloat('proximityBoost', 0.0);
        }

        // Flame sphere
        gl.bindVertexArray(this.sphereVAO);
        glMatrix.mat4.identity(this.model);
        glMatrix.mat4.translate(this.model, this.model,
            [this.flamePos[0], this.flamePos[1], this.flamePos[2]]);
        glMatrix.mat4.scale(this.model, this.model,
            [this.cellSize*0.6, this.cellSize*0.7, this.cellSize*0.4]);
        this.mazeShader.setVec3('lightAmbient', 1.5, 1.0, 0.9);  
        this.mazeShader.setVec3('matDiffuse',   1.0, 0.8, 0.8);
        this.mazeShader.setVec3('matSpecular',  1.45,  0.8,  0.75);
        this.mazeShader.setFloat('shininess',   32.0);
        this.mazeShader.setFloat('useTexture',  1.0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.flameTexture);
        this.mazeShader.setInt('wallTexture', 1);
        this.mazeShader.setMat4('model', this.model);
        this.mazeShader.setFloat('isFlame', 1.0);
        this.mazeShader.setFloat('uTime', currentTime);
        gl.drawArrays(gl.TRIANGLES, 0, this.sphereVertexCount);
        this.mazeShader.setFloat('useTexture',  0.0);
        this.mazeShader.setFloat('isFlame', 0.0);
        this.mazeShader.setVec3('lightAmbient',  0.02, 0.005, 0.01);

        // End scene pass
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.disable(gl.DEPTH_TEST);

        // ── Pass 3: Bright-pass extract → pingpong[0] ─────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingpongFBO[0]);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.bloomBrightShader.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.hdrColorTex);
        this.bloomBrightShader.setInt('hdrScene', 0);
        this.bloomBrightShader.setFloat('threshold', this.lampLit ? 1.2 : 2.0);
        gl.bindVertexArray(this.screenQuadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // ── Pass 4: Gaussian blur (8 passes) ─────────────────────
        this.bloomBlurShader.use();
        let horizontal = true;
        for (let i = 0; i < 4; i++) {
            const writeIdx = horizontal ? 1 : 0;
            const readIdx  = horizontal ? 0 : 1;
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingpongFBO[writeIdx]);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this.bloomBlurShader.setInt('horizontal', horizontal ? 1 : 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.pingpongTex[readIdx]);
            this.bloomBlurShader.setInt('image', 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            horizontal = !horizontal;
        }
        // After 8 passes (even), last write was to pingpong[0]

        // ── Pass 5: Composite → screen ────────────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.bloomCompositeShader.use();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.hdrColorTex);
        this.bloomCompositeShader.setInt('hdrScene', 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.pingpongTex[0]);
        this.bloomCompositeShader.setInt('bloomBlur', 1);
        this.bloomCompositeShader.setFloat('bloomStrength', this.lampLit ? 0.25 : 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        

        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        requestAnimationFrame((now) => this.render(now));
    }

    // ─── INPUT ───────────────────────────────────────────────────

    setupEventListeners() {
        window.addEventListener('keydown', e => {
            this.keys[e.key] = true;
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))
                e.preventDefault();
            if (!this.audioInitialized) this.initSpatialAudio();
            else if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
        });
        window.addEventListener('keyup', e => this.keys[e.key] = false);

        ['mousedown','touchstart','mousemove'].forEach(t =>
            window.addEventListener(t, () => {
                if (!this.audioInitialized) this.initSpatialAudio();
                else if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
            }, { once: true })
        );

        document.getElementById('title-start-btn').onclick = () => {
            document.getElementById('instructions-close-btn').textContent = "Let's Go! \u25B6";
            document.getElementById('instructions-overlay').classList.add('open');
        };

        document.getElementById('instructions-close-btn').onclick = () => {
            document.getElementById('instructions-overlay').classList.remove('open');
            if (this.gameState === 'title') {
                document.getElementById('title-screen').style.display = 'none';
                this.gameState = 'playing';
                this.loadLevel(this.currentLevelIndex);
            }
        };

        document.getElementById('instructions-menu-btn').onclick = () => {
            document.getElementById('instructions-close-btn').textContent = 'Resume \u25B6';
            document.getElementById('menu-overlay').classList.remove('open');
            document.getElementById('instructions-overlay').classList.add('open');
        };

        document.getElementById('next-level-btn').onclick = () => this.loadNextLevel();

        document.getElementById('menu-btn').onclick = () => {
            this.gameState = 'paused';
            document.getElementById('menu-overlay').classList.add('open');
        };

        document.getElementById('resume-btn').onclick = () => {
            this.gameState = 'playing';
            document.getElementById('menu-overlay').classList.remove('open');
        };

        document.getElementById('title-page-btn').onclick = () => {
            document.getElementById('menu-overlay').classList.remove('open');
            this.loadTitleScreen();
        };

        document.getElementById('volume-slider').oninput = e =>
            this._masterVolume = e.target.value / 100;

        document.querySelectorAll('.level-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.level);
                this._sequentialCount  = 0;
                this.currentLevelIndex = idx;
                document.getElementById('menu-overlay').classList.remove('open');
                document.getElementById('title-screen').style.display = 'none';
                this.gameState = 'playing';
                this.loadLevel(idx);
            })
        );

        document.getElementById('victory-menu-btn').onclick = () => {
            document.getElementById('victory-overlay').classList.remove('open');
            this._sequentialCount  = 0;
            this.currentLevelIndex = 0;
            this.loadTitleScreen();
        };

        document.getElementById('victory-restart-btn').onclick = () => {
            document.getElementById('victory-overlay').classList.remove('open');
            this._sequentialCount  = 0;
            this.currentLevelIndex = 0;
            this.gameState = 'playing';
            this.loadLevel(0);
        };
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });