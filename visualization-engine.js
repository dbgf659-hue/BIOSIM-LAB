/**
 * BioSim Lab · Visualization Engine
 * ---------------------------------------------------------------------------
 * Unified visualization API with Chart.js, Three.js, WebGL shaders,
 * and multi-scale navigation from molecular to tissue level.
 */

export class VisualizationEngine {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      theme: options.theme || 'dark',
      enable3D: options.enable3D !== false,
      enableWebGL: options.enableWebGL !== false,
      antialias: options.antialias !== false,
      ...options
    };

    this.charts = new Map();
    this.threeScene = null;
    this.threeRenderer = null;
    this.threeCamera = null;
    this.threeControls = null;
    this.animationId = null;
    this.layers = new Map(); // Visualization layers by scale

    this.currentScale = 'molecular'; // molecular, cellular, tissue, organ
    this.scaleConfigs = {
      molecular: { min: 1e-9, max: 1e-6, unit: 'nm', models: ['atoms', 'proteins', 'dna', 'membranes'] },
      cellular: { min: 1e-6, max: 1e-4, unit: 'µm', models: ['organelles', 'cytoskeleton', 'membranes'] },
      tissue: { min: 1e-4, max: 1e-2, unit: 'mm', models: ['cells', 'extracellular', 'vasculature'] },
      organ: { min: 1e-2, max: 1, unit: 'cm', models: ['organs', 'systems'] }
    };

    this.telemetry = {
      fps: 0,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      gpuMemory: 0
    };
  }

  /**
   * Initialize the visualization engine
   */
  async init() {
    this._createContainer();
    if (this.options.enable3D) await this._initThreeJS();
    this._initChartLayer();
    this._startRenderLoop();
    return this;
  }

  _createContainer() {
    this.container.innerHTML = `
      <div class="viz-engine" style="width:100%;height:100%;position:relative;">
        <canvas class="viz-canvas-3d" id="viz-3d-canvas" style="width:100%;height:100%;position:absolute;top:0;left:0;z-index:1;"></canvas>
        <div class="viz-chart-layer" id="viz-chart-layer" style="width:100%;height:100%;position:absolute;top:0;left:0;z-index:2;pointer-events:none;"></div>
        <div class="viz-ui-overlay" id="viz-ui-overlay" style="width:100%;height:100%;position:absolute;top:0;left:0;z-index:10;pointer-events:auto;"></div>
      </div>
    `;

    this.canvas3d = this.container.querySelector('#viz-3d-canvas');
    this.chartLayer = this.container.querySelector('#viz-chart-layer');
    this.uiOverlay = this.container.querySelector('#viz-ui-overlay');
  }

  async _initThreeJS() {
    // Dynamic import Three.js
    const THREE = await this._loadThreeJS();

    this.THREE = THREE;

    // Renderer
    this.threeRenderer = new THREE.WebGLRenderer({
      canvas: this.canvas3d,
      antialias: this.options.antialias,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.threeRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.threeRenderer.shadowMap.enabled = true;
    this.threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.threeRenderer.toneMappingExposure = 1.0;

    // Scene
    this.threeScene = new THREE.Scene();
    this.threeScene.background = new THREE.Color(0x040a0b);

    // Camera
    this.threeCamera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.001,
      1000
    );
    this.threeCamera.position.set(0, 0, 5);

    // Controls
    if (THREE.OrbitControls) {
      this.threeControls = new THREE.OrbitControls(this.threeCamera, this.threeRenderer.domElement);
      this.threeControls.enableDamping = true;
      this.threeControls.dampingFactor = 0.05;
      this.threeControls.minDistance = 0.1;
      this.threeControls.maxDistance = 100;
    }

    // Lighting
    this._setupLighting();

    // Initialize scale layers
    this._initScaleLayers();

    // Handle resize
    window.addEventListener('resize', () => this._onResize());
  }

  _setupLighting() {
    const THREE = this.THREE;

    // Ambient
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.threeScene.add(ambient);

    // Key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(5, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.threeScene.add(keyLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
    fillLight.position.set(-5, 5, -5);
    this.threeScene.add(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xff8844, 0.2);
    rimLight.position.set(0, -5, -5);
    this.threeScene.add(rimLight);
  }

  _initScaleLayers() {
    const THREE = this.THREE;

    // Molecular layer - atoms, bonds, proteins
    this.layers.set('molecular', new THREE.Group());
    this.layers.get('molecular').name = 'MolecularLayer';
    this.threeScene.add(this.layers.get('molecular'));

    // Cellular layer - organelles, membranes
    this.layers.set('cellular', new THREE.Group());
    this.layers.get('cellular').name = 'CellularLayer';
    this.threeScene.add(this.layers.get('cellular'));

    // Tissue layer - cells, ECM
    this.layers.set('tissue', new THREE.Group());
    this.layers.get('tissue').name = 'TissueLayer';
    this.threeScene.add(this.layers.get('tissue'));

    // Organ layer
    this.layers.set('organ', new THREE.Group());
    this.layers.get('organ').name = 'OrganLayer';
    this.threeScene.add(this.layers.get('organ'));

    // Set initial visibility
    this.setScale('molecular');
  }

  setScale(scale) {
    if (!this.scaleConfigs[scale]) return;

    this.currentScale = scale;

    // Show/hide layers based on scale
    const scaleOrder = ['molecular', 'cellular', 'tissue', 'organ'];
    const currentIndex = scaleOrder.indexOf(scale);

    scaleOrder.forEach((layerName, index) => {
      const layer = this.layers.get(layerName);
      if (layer) {
        // Show current and one level above for context
        layer.visible = index <= currentIndex && index >= Math.max(0, currentIndex - 1);
        if (index === currentIndex) layer.visible = true;
      }
    });

    // Adjust camera for scale
    const config = this.scaleConfigs[scale];
    const distance = config.max * 10;
    this.threeCamera.position.set(0, 0, distance);
    this.threeCamera.near = config.min * 0.1;
    this.threeCamera.far = config.max * 100;
    this.threeCamera.updateProjectionMatrix();

    if (this.threeControls) {
      this.threeControls.minDistance = config.min * 0.5;
      this.threeControls.maxDistance = config.max * 50;
    }
  }

  _initChartLayer() {
    // Chart.js will be used for 2D charts in the chart layer
    this.chartLayer.style.pointerEvents = 'auto';
  }

  /**
   * Create a real-time Chart.js chart
   */
  createChart(id, config) {
    if (!window.Chart) {
      console.warn('Chart.js not loaded');
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.id = `chart-${id}`;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.chartLayer.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    const defaultOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 }, // No animation for real-time
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { enabled: true }
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time' } },
        y: { title: { display: true, text: 'Value' } }
      }
    };

    const mergedConfig = {
      ...config,
      options: { ...defaultOptions, ...config.options }
    };

    const chart = new Chart(ctx, mergedConfig);
    this.charts.set(id, { chart, canvas, config: mergedConfig });

    return chart;
  }

  /**
   * Update chart data efficiently (for real-time streaming)
   */
  updateChart(id, newData, options = {}) {
    const chartObj = this.charts.get(id);
    if (!chartObj) return;

    const { chart, config } = chartObj;
    const { append = true, maxPoints = 1000 } = options;

    if (append) {
      // Append new data points
      config.data.datasets.forEach((dataset, i) => {
        if (newData[i] !== undefined) {
          dataset.data.push(newData[i]);
          if (dataset.data.length > maxPoints) {
            dataset.data.shift();
          }
        }
      });

      // Update labels if time-based
      if (config.data.labels && newData.time !== undefined) {
        config.data.labels.push(newData.time);
        if (config.data.labels.length > maxPoints) config.data.labels.shift();
      }
    } else {
      // Replace all data
      config.data.datasets.forEach((dataset, i) => {
        if (newData[i] !== undefined) dataset.data = newData[i];
      });
    }

    chart.update('none');
  }

  /**
   * Create 3D molecular structure from PDB-like data
   */
  createMolecularStructure(structureData) {
    const THREE = this.THREE;
    const group = new THREE.Group();

    const { atoms, bonds, residues } = structureData;

    // Atom spheres
    const atomGeometry = new THREE.SphereGeometry(0.15, 16, 16);
    const atomMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.1
    });

    const atomMesh = new THREE.InstancedMesh(atomGeometry, atomMaterial, atoms.length);
    atomMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    atomMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(atoms.length * 3), 3);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    atoms.forEach((atom, i) => {
      dummy.position.set(atom.x, atom.y, atom.z);
      dummy.scale.setScalar(atom.vdwRadius || 1);
      dummy.updateMatrix();
      atomMesh.setMatrixAt(i, dummy.matrix);

      // CPK coloring
      const c = this._cpkColor(atom.element);
      color.set(c);
      atomMesh.instanceColor.setXYZ(i, color.r, color.g, color.b);
    });

    atomMesh.instanceMatrix.needsUpdate = true;
    atomMesh.instanceColor.needsUpdate = true;
    group.add(atomMesh);

    // Bonds as cylinders
    if (bonds) {
      const bondGroup = new THREE.Group();
      bonds.forEach(bond => {
        const [a1, a2] = bond;
        const p1 = new THREE.Vector3(...atoms[a1].position);
        const p2 = new THREE.Vector3(...atoms[a2].position);
        const dist = p1.distanceTo(p2);
        const mid = p1.clone().lerp(p2, 0.5);

        const cylGeo = new THREE.CylinderGeometry(0.1, 0.1, dist, 8);
        const cylMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        const cyl = new THREE.Mesh(cylGeo, cylMat);

        cyl.position.copy(mid);
        cyl.lookAt(p2);
        cyl.rotateX(Math.PI / 2);
        bondGroup.add(cyl);
      });
      group.add(bondGroup);
    }

    this.layers.get('molecular').add(group);
    return group;
  }

  _cpkColor(element) {
    const colors = {
      H: 0xffffff, C: 0x333333, N: 0x3355ff, O: 0xff3333,
      P: 0xff8800, S: 0xffff00, Cl: 0x33ff33, Fe: 0xff8888,
      Mg: 0x88ff88, Ca: 0x8888ff, Na: 0x88ffff, K: 0xff88ff
    };
    return colors[element] || 0x888888;
  }

  /**
   * Create cellular structure (organelles, membranes)
   */
  createCellularStructure(cellData) {
    const THREE = this.THREE;
    const group = new THREE.Group();

    const { nucleus, mitochondria, er, golgi, membrane, cytoplasm } = cellData;

    // Cell membrane
    if (membrane) {
      const geo = new THREE.SphereGeometry(membrane.radius || 5, 64, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        roughness: 0.5
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
    }

    // Nucleus
    if (nucleus) {
      const geo = new THREE.SphereGeometry(nucleus.radius || 2, 32, 32);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8844ff,
        transparent: true,
        opacity: 0.4,
        roughness: 0.3
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...(nucleus.position || [0,0,0]));
      group.add(mesh);

      // Nuclear pores
      if (nucleus.pores) {
        const poreGeo = new THREE.TorusGeometry(0.1, 0.03, 8, 16);
        const poreMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
        nucleus.pores.forEach(pos => {
          const pore = new THREE.Mesh(poreGeo, poreMat);
          pore.position.set(...pos);
          group.add(pore);
        });
      }
    }

    // Mitochondria (instanced)
    if (mitochondria && mitochondria.length) {
      const geo = new THREE.CapsuleGeometry(0.15, 0.5, 8, 16);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.4 });
      const mesh = new THREE.InstancedMesh(geo, mat, mitochondria.length);

      const dummy = new THREE.Object3D();
      mitochondria.forEach((mito, i) => {
        dummy.position.set(...mito.position);
        if (mito.rotation) dummy.rotation.set(...mito.rotation);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    // ER network (tubes)
    if (er && er.length) {
      const curve = new THREE.CatmullRomCurve3(er.map(p => new THREE.Vector3(...p)));
      const tubeGeo = new THREE.TubeGeometry(curve, er.length * 4, 0.08, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({ color: 0x44ffff, roughness: 0.3 });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      group.add(tube);
    }

    this.layers.get('cellular').add(group);
    return group;
  }

  /**
   * Create tissue-level visualization (cell populations)
   */
  createTissueStructure(tissueData) {
    const THREE = this.THREE;
    const group = new THREE.Group();

    const { cells, ecm, vessels } = tissueData;

    // Cells as instanced spheres/ellipsoids
    if (cells && cells.length) {
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x88cc88,
        roughness: 0.4,
        transparent: true,
        opacity: 0.8
      });
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3);

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      cells.forEach((cell, i) => {
        dummy.position.set(...cell.position);
        dummy.scale.set(cell.scale || 1, cell.scale || 1, cell.scale || 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Color by cell type/state
        const c = cell.color || 0x88cc88;
        color.set(c);
        mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }

    // ECM as point cloud
    if (ecm && ecm.length) {
      const pointsGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(ecm.length * 3);
      const colors = new Float32Array(ecm.length * 3);
      const sizes = new Float32Array(ecm.length);

      ecm.forEach((p, i) => {
        positions[i*3] = p.x;
        positions[i*3+1] = p.y;
        positions[i*3+2] = p.z;
        colors[i*3] = 0.3;
        colors[i*3+1] = 0.5;
        colors[i*3+2] = 0.3;
        sizes[i] = p.size || 1;
      });

      pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pointsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      pointsGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

      const pointsMat = new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.3,
        sizeAttenuation: true
      });

      const points = new THREE.Points(pointsGeo, pointsMat);
      group.add(points);
    }

    // Vasculature as tubes
    if (vessels && vessels.length) {
      vessels.forEach(vessel => {
        const curve = new THREE.CatmullRomCurve3(vessel.path.map(p => new THREE.Vector3(...p)));
        const tubeGeo = new THREE.TubeGeometry(curve, vessel.path.length * 2, vessel.radius || 0.2, 8, false);
        const tubeMat = new THREE.MeshStandardMaterial({
          color: vessel.type === 'artery' ? 0xff3333 : 0x3333ff,
          roughness: 0.3
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        group.add(tube);
      });
    }

    this.layers.get('tissue').add(group);
    return group;
  }

  /**
   * Add concentration field visualization (3D heatmap)
   */
  addConcentrationField(fieldData) {
    const THREE = this.THREE;
    const { data, dimensions, bounds, colormap = 'viridis' } = fieldData;

    // Create 3D texture
    const texture = new THREE.DataTexture3D(data, dimensions[0], dimensions[1], dimensions[2]);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // Volume rendering shader
    const volumeGeo = new THREE.BoxGeometry(...bounds);
    const volumeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uBounds: { value: new THREE.Vector3(...bounds) },
        uColormap: { value: this._getColormapTexture(colormap) },
        uThreshold: { value: 0.1 },
        uOpacity: { value: 0.5 }
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler3D uTexture;
        uniform vec3 uBounds;
        uniform sampler2D uColormap;
        uniform float uThreshold;
        uniform float uOpacity;
        varying vec3 vPos;

        vec3 sampleVolume(vec3 pos) {
          vec3 uv = (pos + uBounds * 0.5) / uBounds;
          return texture(uTexture, uv).rrr;
        }

        void main() {
          vec3 rayDir = normalize(vPos);
          vec3 pos = -uBounds * 0.5;
          float stepSize = length(uBounds) / 100.0;
          vec4 acc = vec4(0.0);

          for (int i = 0; i < 100; i++) {
            float density = sampleVolume(pos).r;
            if (density > uThreshold) {
              vec3 color = texture2D(uColormap, vec2(density, 0.5)).rgb;
              float alpha = density * uOpacity * 0.1;
              acc.rgb += color * alpha * (1.0 - acc.a);
              acc.a += alpha * (1.0 - acc.a);
            }
            pos += rayDir * stepSize;
            if (pos.x > uBounds.x * 0.5) break;
          }

          gl_FragColor = acc;
        }
      `,
      transparent: true,
      side: THREE.BackSide
    });

    const volume = new THREE.Mesh(volumeGeo, volumeMat);
    this.layers.get('tissue').add(volume);
    return volume;
  }

  _getColormapTexture(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');

    const gradients = {
      viridis: [
        [0, 0x440154], [0.25, 0x3b528b], [0.5, 0x21908c], [0.75, 0x5ec962], [1, 0xfde725]
      ],
      plasma: [
        [0, 0x0d0887], [0.25, 0x7e03a8], [0.5, 0xcc4778], [0.75, 0xf89441], [1, 0xf0f921]
      ],
      inferno: [
        [0, 0x000004], [0.25, 0x780c6d], [0.5, 0xed6925], [0.75, 0xfcfea4], [1, 0xffffff]
      ],
      jet: [
        [0, 0x0000ff], [0.25, 0x00ffff], [0.5, 0x00ff00], [0.75, 0xffff00], [1, 0xff0000]
      ]
    };

    const stops = gradients[name] || gradients.viridis;
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    stops.forEach(([pos, color]) => {
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      grad.addColorStop(pos, `rgb(${r},${g},${b})`);
    });

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Add real-time data overlay (telemetry, parameter values)
   */
  addDataOverlay(data) {
    this.uiOverlay.innerHTML = `
      <div class="viz-telemetry" style="
        position:absolute;top:10px;right:10px;
        background:rgba(4,10,11,0.9);border:1px solid #2ee6c5;
        border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;
        font-size:11px;color:#e8efe9;min-width:200px;z-index:100;
      ">
        <div style="color:#2ee6c5;font-weight:600;margin-bottom:8px;">TELEMETRY</div>
        <div>FPS: <span style="color:${this.telemetry.fps > 30 ? '#22c55e' : '#ef4444'}">${this.telemetry.fps}</span></div>
        <div>Frame: ${this.telemetry.frameTime.toFixed(1)}ms</div>
        <div>Scale: ${this.currentScale}</div>
        <div style="margin-top:8px;border-top:1px solid #1a2a2a;padding-top:8px;">
          ${Object.entries(data || {}).map(([k,v]) =>
            `<div>${k}: <span style="color:#2ee6c5">${typeof v === 'number' ? v.toFixed(3) : v}</span></div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  _startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      const start = performance.now();

      if (this.threeRenderer && this.threeScene && this.threeCamera) {
        if (this.threeControls) this.threeControls.update();
        this.threeRenderer.render(this.threeScene, this.threeCamera);

        // Update telemetry
        this.telemetry.drawCalls = this.threeRenderer.info.render.calls;
        this.telemetry.triangles = this.threeRenderer.info.render.triangles;
      }

      this.telemetry.frameTime = performance.now() - start;
      this.telemetry.fps = Math.round(1000 / this.telemetry.frameTime);
    };
    animate();
  }

  _onResize() {
    if (this.threeRenderer && this.threeCamera) {
      this.threeRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.threeCamera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.threeCamera.updateProjectionMatrix();
    }
  }

  /**
   * Set up WebGL shader for custom visualizations
   */
  createShaderMaterial(vertexShader, fragmentShader, uniforms = {}) {
    return new this.THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false
    });
  }

  /**
   * Dispose and cleanup
   */
  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);

    this.charts.forEach(({ chart, canvas }) => {
      chart.destroy();
      canvas.remove();
    });
    this.charts.clear();

    if (this.threeRenderer) {
      this.threeRenderer.dispose();
      this.threeRenderer = null;
    }

    if (this.threeScene) {
      this.threeScene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      this.threeScene = null;
    }

    this.layers.clear();
  }

  async _loadThreeJS() {
    if (window.THREE) return window.THREE;

    // Load Three.js from CDN
    await this._loadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    await this._loadScript('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js');

    return window.THREE;
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

/**
 * WebGL-accelerated 2D chart for massive datasets
 */
export class WebGLChart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    this.options = options;
    this.data = [];
    this.maxPoints = options.maxPoints || 100000;

    this._initShaders();
    this._initBuffers();
    this._resize();

    window.addEventListener('resize', () => this._resize());
  }

  _initShaders() {
    const gl = this.gl;

    const vs = `#version 300 es
      precision highp float;
      in float aIndex;
      in vec2 aPoint;
      uniform vec2 uResolution;
      uniform float uPointCount;
      uniform mat3 uTransform;
      out float vIndex;
      void main() {
        vIndex = aIndex;
        vec2 pos = uTransform * vec3(aPoint, 1.0);
        gl_Position = vec4(pos.x / uResolution.x * 2.0 - 1.0, pos.y / uResolution.y * -2.0 + 1.0, 0, 1);
        gl_PointSize = 3.0;
      }
    `;

    const fs = `#version 300 es
      precision highp float;
      in float vIndex;
      uniform vec4 uColor;
      uniform float uPointCount;
      out vec4 outColor;
      void main() {
        float alpha = smoothstep(0.0, 1.0, vIndex / uPointCount);
        outColor = uColor * alpha;
      }
    `;

    this.program = this._createProgram(vs, fs);
    this.attribs = {
      aIndex: gl.getAttribLocation(this.program, 'aIndex'),
      aPoint: gl.getAttribLocation(this.program, 'aPoint')
    };
    this.uniforms = {
      uResolution: gl.getUniformLocation(this.program, 'uResolution'),
      uPointCount: gl.getUniformLocation(this.program, 'uPointCount'),
      uTransform: gl.getUniformLocation(this.program, 'uTransform'),
      uColor: gl.getUniformLocation(this.program, 'uColor')
    };
  }

  _createProgram(vs, fs) {
    const gl = this.gl;
    const createShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };

    const vertexShader = createShader(gl.VERTEX_SHADER, vs);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fs);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }

  _initBuffers() {
    const gl = this.gl;
    this.indexBuffer = gl.createBuffer();
    this.pointBuffer = gl.createBuffer();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setData(points, color = [0.18, 0.9, 0.77, 1]) {
    this.data = points;
    const gl = this.gl;

    const indices = new Float32Array(points.length);
    const pointData = new Float32Array(points.length * 2);

    points.forEach((p, i) => {
      indices[i] = i;
      pointData[i*2] = p.x;
      pointData[i*2+1] = p.y;
    });

    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, pointData, gl.DYNAMIC_DRAW);

    this.pointCount = points.length;
    this.color = color;
  }

  render(transform = [1,0,0, 0,1,0, 0,0,1]) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uPointCount, this.pointCount);
    gl.uniformMatrix3fv(this.uniforms.uTransform, false, transform);
    gl.uniform4fv(this.uniforms.uColor, this.color);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.enableVertexAttribArray(this.attribs.aIndex);
    gl.vertexAttribPointer(this.attribs.aIndex, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.enableVertexAttribArray(this.attribs.aPoint);
    gl.vertexAttribPointer(this.attribs.aPoint, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.pointCount);
  }
}

export default VisualizationEngine;