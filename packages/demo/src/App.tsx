import { useState } from 'react';
import { PinchPanContainer } from './PinchPanContainer.js';
import { CarouselContainer } from './CarouselContainer.js';

const IMAGE_URL =
  'https://picsum.photos/id/599/400/300';

const CAROUSEL_ITEMS = [
  { label: 'Item 1', bg: 'bg-indigo-600' },
  { label: 'Item 2', bg: 'bg-emerald-600' },
  { label: 'Item 3', bg: 'bg-rose-600' },
  { label: 'Item 4', bg: 'bg-amber-500' },
  { label: 'Item 5', bg: 'bg-violet-600' },
];

type Tab = 'pinch-pan' | 'carousel';

export function App() {
  const [tab, setTab] = useState<Tab>('pinch-pan');

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <header className="flex items-center px-4 py-3 bg-gray-800 shadow text-white shrink-0 gap-6">
        <h1 className="text-lg font-semibold tracking-wide">Mimosa Demo</h1>
        <nav className="flex gap-2">
          <button
            className={`px-3 py-1 rounded text-sm ${tab === 'pinch-pan' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setTab('pinch-pan')}
          >
            Pinch / Pan
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${tab === 'carousel' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setTab('carousel')}
          >
            Carousel
          </button>
        </nav>
      </header>

      {tab === 'pinch-pan' && (
        <PinchPanContainer className="flex-1 w-full">
          <img
            src={IMAGE_URL}
            alt="demo"
            draggable={false}
            style={{ display: 'block', maxWidth: 'none', userSelect: 'none' }}
          />
        </PinchPanContainer>
      )}

      {tab === 'carousel' && (
        <div className="flex-1 flex flex-col">
          <CarouselContainer
            itemCount={CAROUSEL_ITEMS.length}
            itemWidth={400}
            className="flex-1"
          >
            {CAROUSEL_ITEMS.map(({ label, bg }) => (
              <div
                key={label}
                className={`${bg} flex items-center justify-center text-white text-2xl font-bold shrink-0`}
                style={{ width: 400, height: '100%' }}
              >
                {label}
              </div>
            ))}
          </CarouselContainer>
          <p className="text-center text-gray-500 text-sm py-2">
            Drag or swipe to navigate · Snaps to each item
          </p>
        </div>
      )}
    </div>
  );
}
