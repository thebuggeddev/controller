import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/responsive.css';

import { App } from './App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

const app = new App();
void app.mount(root);
