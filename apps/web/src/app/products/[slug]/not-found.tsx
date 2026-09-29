export default function NotFound() {
  return (
    <div className="container">
      <div className="not-found">
        <h1>Product Not Found</h1>
        <p>The product you're looking for doesn't exist or is no longer available.</p>
        <a href="/products" className="back-link">← Back to Products</a>
      </div>
    </div>
  );
}
