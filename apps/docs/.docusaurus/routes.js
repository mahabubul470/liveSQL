import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/',
    component: ComponentCreator('/', 'aea'),
    routes: [
      {
        path: '/',
        component: ComponentCreator('/', 'a7b'),
        routes: [
          {
            path: '/',
            component: ComponentCreator('/', '873'),
            routes: [
              {
                path: '/api/client',
                component: ComponentCreator('/api/client', '4e1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/api/react',
                component: ComponentCreator('/api/react', 'e97'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/api/server',
                component: ComponentCreator('/api/server', 'afb'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/api/svelte',
                component: ComponentCreator('/api/svelte', 'ee6'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/api/vue',
                component: ComponentCreator('/api/vue', '479'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/how-it-works',
                component: ComponentCreator('/concepts/how-it-works', 'c9d'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/guides/migration-supabase',
                component: ComponentCreator('/guides/migration-supabase', 'c3c'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/',
                component: ComponentCreator('/', '7da'),
                exact: true,
                sidebar: "docs"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
