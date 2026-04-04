import { PinchPanContainer } from './PinchPanContainer.js';

// A freely available high-resolution sample image
const IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';

export function App() {
  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <header className="flex items-center px-4 py-3 bg-gray-800 shadow text-white shrink-0">
        <h1 className="text-lg font-semibold tracking-wide">Mimosa Demo</h1>
        <span className="ml-3 text-sm text-gray-400">Pinch / Pan / Wheel zoom</span>
      </header>

      <PinchPanContainer className="flex-1 w-full">
        <img
          src={IMAGE_URL}
          alt="demo"
          draggable={false}
          style={{ display: 'block', maxWidth: 'none', userSelect: 'none' }}
        />
      </PinchPanContainer>
    </div>
  );
}
