// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerTemplate } from './template';
import { wardrobeTemplate } from './templates/wardrobe';

export * from './template';
export { wardrobeTemplate } from './templates/wardrobe';

registerTemplate(wardrobeTemplate);
// bed and kommode templates register here as they land (design/02 §2, §3)
