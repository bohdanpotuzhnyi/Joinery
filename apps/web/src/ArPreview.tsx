// SPDX-License-Identifier: AGPL-3.0-or-later
import '@google/model-viewer';
declare module 'react' { namespace JSX { interface IntrinsicElements { 'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; ar?: boolean; 'ar-modes'?: string; 'camera-controls'?: boolean; 'shadow-intensity'?: string; alt?: string }; } } }
export function ArPreview({ glbBase64 }: { glbBase64: string }) { return <model-viewer src={`data:model/gltf-binary;base64,${glbBase64}`} ar ar-modes="webxr scene-viewer quick-look" camera-controls shadow-intensity="1" alt="Furniture model for room preview" style={{ width: '100%', height: '320px', background: '#17130f', borderRadius: '8px' }} />; }
