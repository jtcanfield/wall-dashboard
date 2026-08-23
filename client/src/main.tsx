import { render } from 'preact';
import { App } from './app';
import { mountStageScaling } from './stage';
import './styles.css';
import 'uplot/dist/uPlot.min.css';

const stage = document.getElementById('stage');
if (!stage) throw new Error('#stage missing from index.html');

mountStageScaling(stage);
render(<App />, stage);
