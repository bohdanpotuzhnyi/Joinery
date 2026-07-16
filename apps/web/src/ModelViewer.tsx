// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Interactive WebGL view of the exact GLB emitted by @furniture/scene. */
export function ModelViewer({ glbBase64 }: { glbBase64: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el || !glbBase64) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#17130f');
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / 320, 0.01, 100); camera.position.set(2.8, 2.3, 3.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(el.clientWidth, 320); el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x30251b, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 5, 4); scene.add(key);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0.9, 0);
    scene.add(new THREE.GridHelper(4, 12, 0x8a7350, 0x3d3328));
    let object: THREE.Object3D | undefined;
    const bytes = Uint8Array.from(atob(glbBase64), (c) => c.charCodeAt(0));
    new GLTFLoader().parse(bytes.buffer, '', (gltf) => {
      object = gltf.scene; scene.add(object);
      const bounds = new THREE.Box3().setFromObject(object); const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
      object.position.sub(center); controls.target.set(0, Math.max(0.3, size.y / 2), 0);
      camera.position.set(Math.max(2, size.length() * 1.35), Math.max(1.5, size.length()), Math.max(2, size.length() * 1.35)); controls.update();
    });
    let frame = 0; const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); }; render();
    const resize = () => { if (!el.clientWidth) return; camera.aspect = el.clientWidth / 320; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, 320); };
    const observer = new ResizeObserver(resize); observer.observe(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [glbBase64]);
  return <div className="model-viewer" ref={host} aria-label="Interactive 3D furniture model; drag to rotate and scroll to zoom" />;
}
