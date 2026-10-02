'use client';

import { useState } from 'react';

// Minimal temporary UI for testing Hub / Fulfillment
export default function HubPortal() {
  const [activeTab, setActiveTab] = useState<'shipments' | 'batches'>('shipments');

  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <h1 className="text-2xl font-bold mb-4">Hub Operations</h1>
      <div className="flex gap-4 border-b border-gray-300 pb-2 mb-4">
        <button 
          className={`font-semibold ${activeTab === 'shipments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('shipments')}
        >
          Pending Shipments
        </button>
        <button 
          className={`font-semibold ${activeTab === 'batches' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('batches')}
        >
          Delivery Batches
        </button>
      </div>

      {activeTab === 'shipments' && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Shipments to Prepare</h2>
          <div className="bg-yellow-50 p-4 rounded border border-yellow-200 text-sm">
            <i>(Shipments allocated via OrderPlacedEvent appear here)</i>
          </div>
          {/* Mock table */}
          <table className="w-full mt-4 text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="p-2">ID</th>
                <th className="p-2">Order</th>
                <th className="p-2">Status</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 text-gray-500" colSpan={4}>No shipments found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'batches' && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Active Delivery Batches</h2>
          <button className="bg-blue-600 text-white px-4 py-2 rounded text-sm mb-4">Create New Batch</button>
          <div className="bg-gray-50 p-4 rounded border border-gray-200 text-sm">
            <i>(Batches for couriers)</i>
          </div>
        </div>
      )}
    </div>
  );
}
