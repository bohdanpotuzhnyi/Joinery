// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerTemplate } from './template';
import { bedTemplate } from './templates/bed';
import { vanityTemplate } from './templates/vanity';
import { wardrobeTemplate } from './templates/wardrobe';

export * from './template';
export { bedTemplate } from './templates/bed';
export { vanityTemplate } from './templates/vanity';
export { wardrobeTemplate } from './templates/wardrobe';

registerTemplate(wardrobeTemplate);
registerTemplate(bedTemplate);
registerTemplate(vanityTemplate);
