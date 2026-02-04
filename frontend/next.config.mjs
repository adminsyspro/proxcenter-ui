import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
    basePath: process.env.BASEPATH,
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
