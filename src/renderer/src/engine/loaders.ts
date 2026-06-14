import * as THREE from 'three'
import { GLTFLoader, OBJLoader } from 'three-stdlib'

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(dataUrl)
  return res.arrayBuffer()
}

async function dataUrlToText(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl)
  return res.text()
}

// Normalize a geometry: center it and scale to fit a target height.
function normalizeGeometry(geo: THREE.BufferGeometry, targetHeight = 2.0): void {
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  geo.translate(-center.x, -center.y, -center.z)
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const scale = targetHeight / maxDim
  geo.scale(scale, scale, scale)
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
}

// Pick the highest-vertex-count mesh in a scene, bake its world transform.
function dominantGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true)
  let best: THREE.BufferGeometry | null = null
  let bestCount = -1
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry.clone()
      g.applyMatrix4(mesh.matrixWorld)
      const count = g.getAttribute('position')?.count ?? 0
      if (count > bestCount) {
        bestCount = count
        best = g
      }
    }
  })
  return best
}

export async function loadModelGeometry(
  dataUrl: string,
  name: string
): Promise<THREE.BufferGeometry> {
  const ext = name.split('.').pop()?.toLowerCase() ?? 'glb'

  if (ext === 'obj') {
    const text = await dataUrlToText(dataUrl)
    const group = new OBJLoader().parse(text)
    const geo = dominantGeometry(group)
    if (!geo) throw new Error('No mesh found in OBJ')
    normalizeGeometry(geo)
    return geo
  }

  // glb (binary) or gltf (json)
  const loader = new GLTFLoader()
  const root = await new Promise<THREE.Object3D>((resolve, reject) => {
    const onDone = (gltf: { scene: THREE.Object3D }): void => resolve(gltf.scene)
    if (ext === 'gltf') {
      dataUrlToText(dataUrl)
        .then((text) => loader.parse(text, '', onDone, reject))
        .catch(reject)
    } else {
      dataUrlToArrayBuffer(dataUrl)
        .then((buf) => loader.parse(buf, '', onDone, reject))
        .catch(reject)
    }
  })
  const geo = dominantGeometry(root)
  if (!geo) throw new Error('No mesh found in model')
  normalizeGeometry(geo)
  return geo
}
