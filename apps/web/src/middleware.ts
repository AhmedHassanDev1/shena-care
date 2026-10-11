import { NextResponse } from 'next/server';

/**
 * The design lab is a development tool. In production it returns a real 404 status unless
 * DESIGN_LAB=enabled. (The page also calls notFound(), but the root loading.tsx streams a 200
 * status before that can take effect.)
 */
export function middleware() {
  if (process.env.NODE_ENV === 'production' && process.env.DESIGN_LAB !== 'enabled') {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/design-lab', '/design-lab/:path*'],
};
