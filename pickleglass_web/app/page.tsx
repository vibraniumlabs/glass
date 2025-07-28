'use client';

import { useState } from 'react';
import GlassAgent from '../components/GlassAgent';

export default function Home() {
  const [isAgentVisible, setIsAgentVisible] = useState(false);

  const incidentContext = "This is a sample incident context. In a real scenario, this would be dynamically loaded from the page or an API.";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Vibe Incident Page (Mock)</h1>
      <button
        onClick={() => setIsAgentVisible(true)}
        className="px-8 py-4 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75"
      >
        Start Vibe AI Copilot
      </button>

      {isAgentVisible && (
        <GlassAgent
          incidentContext={incidentContext}
          onClose={() => setIsAgentVisible(false)}
        />
      )}
    </main>
  );
} 