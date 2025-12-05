## whiteboard component spec

- create exactly and only one component with all the following features

- It must run in any modern browser (Chrome, Edge, Safari) on PC, Tablet and Mobile (Android and I-Phone)

Exact feature list:
- open SVG
- save SVG
- color picker
- stroke width slider
- mode options: draw, pan, erase
- multi-touch
- on mobile zoom with 2 fingers, freeze the reference frame at pinch start
- on pc zoom with mouse wheel
- zoom at current mouse or finger location  
- pan to have infinit board, on pan keep content locked to the finger

- erase when touching or crossing a line
- consider screen/viewbox conversions on pan and zoom
- no grid

Behavior expectations:
- SVG file openable standalone in a browser after download
- Board resize dynamically with the window

Testing target:
- Desktop 
- Mobile (iPhone and Android)
- Single-touch gestures (drawing with one finger only)

