import { Component } from '@angular/core';
import { Whiteboard } from './whiteboard/whiteboard';

@Component({
  selector: 'app-root',
  imports: [Whiteboard],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
