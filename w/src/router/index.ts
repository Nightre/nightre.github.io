import { createRouter, createWebHashHistory } from 'vue-router'

import Home from '../pages/Home.vue'
import SetLogic from '../pages/SetLogic.vue'
import Inequality from '../pages/Inequality.vue'
import QuadraticFunction from '../pages/QuadraticFunction.vue'
import Sequence from '../pages/Sequence.vue'
import TrigonometricFunction from '../pages/TrigonometricFunction.vue'
import FunctionApplication from '../pages/FunctionApplication.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/set-logic', name: 'set-logic', component: SetLogic },
    { path: '/inequality', name: 'inequality', component: Inequality },
    { path: '/quadratic-function', name: 'quadratic-function', component: QuadraticFunction },
    { path: '/sequence', name: 'sequence', component: Sequence },
    { path: '/trigonometric-function', name: 'trigonometric-function', component: TrigonometricFunction },
    { path: '/function-application', name: 'function-application', component: FunctionApplication }
  ]
})

export default router
