'use client';

// Minimal temporary UI for testing Delivery driver interactions
export default function DeliveryPortal() {
  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <h1 className="text-2xl font-bold mb-4">Delivery App</h1>
      <div className="bg-blue-50 p-4 rounded border border-blue-200 text-sm mb-4">
        <i>Driver view: See assigned stops, mark delivered/failed, collect COD.</i>
      </div>

      <h2 className="text-lg font-semibold mb-2">My Current Route</h2>
      
      <div className="border border-gray-300 rounded overflow-hidden">
        <div className="p-4 border-b border-gray-300 flex justify-between items-center">
          <div>
            <h3 className="font-semibold">Stop 1: John Doe</h3>
            <p className="text-sm text-gray-600">123 Main St</p>
            <p className="text-sm font-semibold text-red-600 mt-1">COD: 450 EGP</p>
          </div>
          <div className="flex flex-col gap-2">
            <button className="bg-green-600 text-white px-3 py-1 rounded text-sm">Mark Delivered</button>
            <button className="bg-red-600 text-white px-3 py-1 rounded text-sm">Mark Failed</button>
          </div>
        </div>
        <div className="p-4 flex justify-between items-center opacity-50 bg-gray-50">
          <div>
            <h3 className="font-semibold">Stop 2: Jane Smith</h3>
            <p className="text-sm text-gray-600">456 Elm St</p>
            <p className="text-sm font-semibold text-red-600 mt-1">COD: 0 EGP (Paid)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
