"use strict";

class Shader {
    constructor(gl, vertexSource, fragmentSource) {
        this.gl = gl;

        // Step 1: compile vertex shader
        const vertexShader = gl.createShader(gl.VERTEX_SHADER)
        gl.shaderSource(vertexShader, vertexSource)
        gl.compileShader(vertexShader)
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
            console.log(gl.getShaderInfoLog(vertexShader));

        // Step 2: compile fragment shader (same steps, gl.FRAGMENT_SHADER)
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
        gl.shaderSource(fragmentShader, fragmentSource)
        gl.compileShader(fragmentShader)
        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)){
            console.log(gl.getShaderInfoLog(fragmentShader));
        }

        // Step 3: link program
        const shaderProgram = gl.createProgram()
        gl.attachShader(shaderProgram, vertexShader); 
        gl.attachShader(shaderProgram, fragmentShader); 
        gl.linkProgram(shaderProgram)
        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)){
            console.log(gl.getProgramInfoLog(shaderProgram));
        }
        this.ID = shaderProgram;        

        // Step 4: clean up
        gl.deleteShader(vertexShader); 
        gl.deleteShader(fragmentShader);

        // cache for uniform locations so we don't look them up every frame
        this._uniformCache = {};
    }

    use() {
        this.gl.useProgram(this.ID);    // activate this shader program
    }

    // helper: get uniform location (check cache first)
    _getLoc(name) {

        if (!(name in this._uniformCache))
            this._uniformCache[name] = this.gl.getUniformLocation(this.ID, name);
        
        return this._uniformCache[name];
    }

    setInt(name, value) {
        this.gl.uniform1i(this._getLoc(name), value);
    }

    setFloat(name, value) {
        this.gl.uniform1f(this._getLoc(name), value);
    }

    setVec3(name, x, y, z) {
        // handle two cases:
        // 1. called with a Float32Array/array: gl.uniform3fv
        if (x instanceof Float32Array || Array.isArray(x)) {
            this.gl.uniform3fv(this._getLoc(name), x);
        } else {
             this.gl.uniform3f(this._getLoc(name), x, y, z);
        }
    }

    setMat4(name, mat) {
        this.gl.uniformMatrix4fv(this._getLoc(name), false, mat);
    }
}