// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerTemplate } from './template';
import { bedTemplate } from './templates/bed';
import { tableTemplate } from './templates/table';
import { vanityTemplate } from './templates/vanity';
import { wardrobeTemplate } from './templates/wardrobe';

export * from './template';
export { bedTemplate } from './templates/bed';
export { vanityTemplate } from './templates/vanity';
export { wardrobeTemplate } from './templates/wardrobe';
export {
  tableTemplate, parseTableBrief, generateTableVariants,
  type TableBrief, type TableVariant, type TopShape,
} from './templates/table';

registerTemplate(wardrobeTemplate);
registerTemplate(bedTemplate);
registerTemplate(vanityTemplate);
registerTemplate(tableTemplate);
