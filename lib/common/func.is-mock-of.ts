import { PipeTransform } from '@angular/core';

import { MockedComponent } from '../mock-component/types';
import { MockedDirective } from '../mock-directive/types';
import { MockedModule } from '../mock-module/types';
import { MockedPipe } from '../mock-pipe/types';

import { Type } from './core.types';
import { isNgDef } from './func.is-ng-def';

/**
 * Checks whether the instance derives from a mock module.
 *
 * @see https://github.com/ike18t/ng-mocks#ismockof
 */
export function isMockOf<T>(instance: any, declaration: Type<T>, ngType: 'm'): instance is MockedModule<T>;

/**
 * Checks whether the instance derives from a mock component.
 *
 * @see https://github.com/ike18t/ng-mocks#ismockof
 */
export function isMockOf<T>(instance: any, declaration: Type<T>, ngType: 'c'): instance is MockedComponent<T>;

/**
 * Checks whether the instance derives from a mock directive.
 *
 * @see https://github.com/ike18t/ng-mocks#ismockof
 */
export function isMockOf<T>(instance: any, declaration: Type<T>, ngType: 'd'): instance is MockedDirective<T>;

/**
 * Checks whether the instance derives from a mock pipe.
 *
 * @see https://github.com/ike18t/ng-mocks#ismockof
 */
export function isMockOf<T extends PipeTransform>(
  instance: any,
  declaration: Type<T>,
  ngType: 'p'
): instance is MockedPipe<T>;

/**
 * Checks whether the instance derives from a mock type.
 *
 * @see https://github.com/ike18t/ng-mocks#ismockof
 */
export function isMockOf<T>(instance: any, declaration: Type<T>): instance is T;

export function isMockOf<T>(instance: any, declaration: Type<T>, ngType?: any): instance is T {
  return (
    typeof instance === 'object' &&
    instance.__ngMocksMock &&
    instance.constructor === declaration &&
    (ngType ? isNgDef(instance.constructor, ngType) : isNgDef(instance.constructor))
  );
}
