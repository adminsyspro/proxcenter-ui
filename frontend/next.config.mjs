import createNextIntlPlugin from 'next-intl/plugin'
import { lstatSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * Turbopack requires its `root` to be absolute and to CONTAIN the real
 * node_modules. In a git worktree we symlink node_modules to the main
 * checkout, which lives outside the worktree directory; Turbopack then
 * aborts with "Symlink node_modules is invalid, it points out of the
 * filesystem root". Detect that case and widen the root to the common
 * ancestor of the worktree and the symlink target, so `npm run dev`
 * keeps using Turbopack inside worktrees. A normal checkout (real
 * node_modules) just uses the current directory, unchanged.
 */
function resolveTurbopackRoot() {
    const cwd = process.cwd()
    try {
        const nm = resolve(cwd, 'node_modules')
        if (lstatSync(nm).isSymbolicLink()) {
            const target = realpathSync(nm)
            const a = cwd.split(sep)
            const b = target.split(sep)
            let i = 0
            while (i < a.length && i < b.length && a[i] === b[i]) i++
            return a.slice(0, i).join(sep) || sep
        }
    } catch {
        // Fall back to the current directory on any fs error.
    }
    return cwd
}

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
        root: resolveTurbopackRoot(),
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
