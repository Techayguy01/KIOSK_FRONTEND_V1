module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/backend', '<rootDir>/frontend'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    collectCoverageFrom: [
        'backend/src/**/*.ts',
        'frontend/**/*.ts',
        'frontend/**/*.tsx',
        '!**/*.d.ts',
        '!**/node_modules/**',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/frontend/$1',
        '^@contracts/(.*)$': '<rootDir>/shared/contracts/$1',
    },
};
