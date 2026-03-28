import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    basePath: process.env.BASEPATH,
    poweredByHeader: false,
    serverExternalPackages: ['ssh2'],
    experimental: {
        serverActions: {
            bodySizeLimit: '10gb',
        },
        proxyClientMaxBodySize: '10gb',
    },
    turbopack: {
        root: '.',
    },
    headers: async () => [
        {
            source: '/(.*)',
            headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
            ],
        },
    ],
    redirects: async () => {
        return [
            {
                source: '/',
                destination: '/home',
                permanent: true,
                locale: false
            }
        ];
    }
};

export default withNextIntl(nextConfig);
