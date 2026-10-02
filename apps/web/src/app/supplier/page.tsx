'use client';

import { useState } from 'react';

// Minimal temporary UI for testing Supplier interactions
export default function SupplierPortal() {
  const [activeTab, setActiveTab] = useState<'offers' | 'pos'>('offers');

  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <h1 className="text-2xl font-bold mb-4">Supplier Portal</h1>
      <div className="flex gap-4 border-b border-gray-300 pb-2 mb-4">
        <button 
          className={`font-semibold ${activeTab === 'offers' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('offers')}
        >
          My Offers
        </button>
        <button 
          className={`font-semibold ${activeTab === 'pos' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          onClick={() => setActiveTab('pos')}
        >
          Purchase Orders
        </button>
      </div>

      {activeTab === 'offers' && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Manage Product Offers</h2>
          <button className="bg-blue-600 text-white px-4 py-2 rounded text-sm mb-4">Create Offer</button>
          <table className="w-full mt-4 text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="p-2">Product</th>
                <th className="p-2">Price</th>
                <th className="p-2">Stock</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 text-gray-500" colSpan={4}>No offers found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'pos' && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Incoming Purchase Orders</h2>
          <div className="bg-yellow-50 p-4 rounded border border-yellow-200 text-sm">
            <i>(Review POs and confirm availability)</i>
          </div>
        </div>
      )}
    </div>
  );
}
