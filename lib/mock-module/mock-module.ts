import { CommonModule } from '@angular/common';
import { core } from '@angular/compiler';
import { ApplicationModule, NgModule, Provider } from '@angular/core';
import { getTestBed } from '@angular/core/testing';

import {
  extendClass,
  flatten,
  getMockedNgDefOf,
  isNgDef,
  isNgModuleDefWithProviders,
  Mock,
  MockOf,
  NgModuleWithProviders,
  Type,
} from '../common';
import { ngMocksUniverse } from '../common/ng-mocks-universe';
import { ngModuleResolver } from '../common/reflect';
import { MockComponent } from '../mock-component';
import { MockDirective } from '../mock-directive';
import { MockPipe } from '../mock-pipe';
import { MockService, mockServiceHelper } from '../mock-service';

export type MockedModule<T> = T & Mock & {};

const neverMockProvidedFunction = ['DomRendererFactory2', 'DomSharedStylesHost', 'EventManager', 'RendererFactory2'];

/**
 * Can be changed any time.
 *
 * @internal
 */
export function MockProvider(provider: any): Provider | undefined {
  const provide = typeof provider === 'object' && provider.provide ? provider.provide : provider;
  if (ngMocksUniverse.flags.has('cacheProvider') && ngMocksUniverse.cacheProviders.has(provide)) {
    return ngMocksUniverse.cacheProviders.get(provide);
  }

  // Tokens are special subject, we can skip adding them because in a mocked module they are useless.
  // The main problem is that providing undefined to HTTP_INTERCEPTORS and others breaks their code.
  // If a testing module / component requires omitted tokens then they should be provided manually
  // during creation of TestBed module.
  if (typeof provide === 'object' && provide.ngMetadataName === 'InjectionToken') {
    return undefined;
  }

  if (typeof provide === 'function' && neverMockProvidedFunction.indexOf(provide.name) !== -1) {
    return provider;
  }

  const mockedProvider = mockServiceHelper.useFactory(ngMocksUniverse.cacheMocks.get(provide) || provide, () =>
    MockService(provide)
  );
  /* istanbul ignore else */
  if (ngMocksUniverse.flags.has('cacheProvider')) {
    ngMocksUniverse.cacheProviders.set(provide, mockedProvider);
  }

  return mockedProvider;
}

export function MockModule<T>(module: Type<T>): Type<T>;
export function MockModule<T>(module: NgModuleWithProviders<T>): NgModuleWithProviders<T>;
export function MockModule(module: any): any {
  let ngModule: Type<any>;
  let ngModuleProviders: Provider[] | undefined;
  let mockModule: typeof ngModule | undefined;
  let mockModuleProviders: typeof ngModuleProviders;
  let mockModuleDef: NgModule | undefined;
  let releaseSkipMockFlag = false;

  if (isNgModuleDefWithProviders(module)) {
    ngModule = module.ngModule;
    if (module.providers) {
      ngModuleProviders = module.providers;
    }
  } else {
    ngModule = module;
  }

  if (NEVER_MOCK.indexOf(ngModule) !== -1) {
    return module;
  }

  // We are inside of an 'it'.
  // It's fine to to return a mock or to throw an exception if it wasn't mocked in TestBed.
  if (!ngModuleProviders && (getTestBed() as any)._instantiated) {
    try {
      return getMockedNgDefOf(ngModule, 'm');
    } catch (error) {
      // looks like an in-test mock.
    }
  }

  // Every module should be mocked only once to avoid errors like:
  // Failed: Type ...Component is part of the declarations of 2 modules: ...Module and ...Module...
  if (ngMocksUniverse.flags.has('cacheModule') && ngMocksUniverse.cacheMocks.has(ngModule)) {
    mockModule = ngMocksUniverse.cacheMocks.get(ngModule);
  }

  // Now we check if we need to keep the original module or to replace it with some other.
  if (!mockModule && ngMocksUniverse.builder.has(ngModule)) {
    const instance = ngMocksUniverse.builder.get(ngModule);
    if (isNgDef(instance, 'm') && instance !== ngModule) {
      mockModule = instance;
    }
    if (!ngMocksUniverse.flags.has('skipMock')) {
      releaseSkipMockFlag = true;
      ngMocksUniverse.flags.add('skipMock');
    }
  }

  if (!mockModule) {
    let meta: core.NgModule;
    try {
      meta = ngModuleResolver.resolve(ngModule);
    } catch (e) {
      /* istanbul ignore next */
      throw new Error('ng-mocks is not in JIT mode and cannot resolve declarations');
    }

    const [changed, ngModuleDef] = MockNgDef(meta, ngModule);
    if (changed) {
      mockModuleDef = ngModuleDef;
    }
  }

  if (mockModuleDef) {
    const parent = ngMocksUniverse.flags.has('skipMock') ? ngModule : Mock;
    mockModule = extendClass(parent);

    // the last thing is to apply decorators.
    NgModule(mockModuleDef)(mockModule as any);
    MockOf(ngModule)(mockModule as any);

    /* istanbul ignore else */
    if (ngMocksUniverse.flags.has('cacheModule')) {
      ngMocksUniverse.cacheMocks.set(ngModule, mockModule);
    }
  }
  if (!mockModule) {
    mockModule = ngModule;
  }

  if (ngModuleProviders) {
    const [changed, ngModuleDef] = MockNgDef({ providers: ngModuleProviders });
    mockModuleProviders = changed ? ngModuleDef.providers : ngModuleProviders;
  }

  if (releaseSkipMockFlag) {
    ngMocksUniverse.flags.delete('skipMock');
  }

  return mockModule === ngModule && mockModuleProviders === ngModuleProviders
    ? module
    : isNgModuleDefWithProviders(module)
    ? { ngModule: mockModule, ...(mockModuleProviders ? { providers: mockModuleProviders } : {}) }
    : mockModule;
}

const NEVER_MOCK: Array<Type<any>> = [CommonModule, ApplicationModule];

/**
 * Can be changed at any time.
 *
 * @internal
 */
export function MockNgDef(ngModuleDef: NgModule, ngModule?: Type<any>): [boolean, NgModule] {
  let changed = !ngMocksUniverse.flags.has('skipMock');
  const mockedModuleDef: NgModule = {};
  const {
    bootstrap = [],
    declarations = [],
    entryComponents = [],
    exports = [],
    imports = [],
    providers = [],
  } = ngModuleDef;

  const resolutions = new Map();

  // resolveProvider is a special case because of the def structure.
  const resolveProvider = (def: Provider) =>
    mockServiceHelper.resolveProvider(def, resolutions, flag => {
      changed = changed || flag;
    });

  const resolve = (def: any) => {
    let mockedDef: typeof def;
    if (resolutions.has(def)) {
      return resolutions.get(def);
    }
    // skipping excluded things
    if (ngMocksUniverse.builder.has(def) && ngMocksUniverse.builder.get(def) === null) {
      changed = changed || true;
      resolutions.set(def, undefined);
      return;
    }

    ngMocksUniverse.touches.add(isNgModuleDefWithProviders(def) ? def.ngModule : def);

    // First we mock modules.
    if (!mockedDef && isNgDef(def, 'm')) {
      mockedDef = MockModule(def);
    }
    if (!mockedDef && isNgModuleDefWithProviders(def)) {
      mockedDef = MockModule(def);
      resolutions.set(def.ngModule, mockedDef.ngModule);
    }

    // Then we check decisions whether we should keep or replace a def.
    if (!mockedDef && ngMocksUniverse.builder.has(def)) {
      mockedDef = ngMocksUniverse.builder.get(def);
    }

    // And then we mock what we have if it wasn't blocked by the skipMock.
    if (!mockedDef && ngMocksUniverse.flags.has('skipMock')) {
      mockedDef = def;
    }
    if (!mockedDef && isNgDef(def, 'c')) {
      mockedDef = MockComponent(def);
    }
    if (!mockedDef && isNgDef(def, 'd')) {
      mockedDef = MockDirective(def);
    }
    if (!mockedDef && isNgDef(def, 'p')) {
      mockedDef = MockPipe(def);
    }

    resolutions.set(def, mockedDef);
    changed = changed || mockedDef !== def;
    return mockedDef;
  };

  if (declarations && declarations.length) {
    mockedModuleDef.declarations = flatten(declarations)
      .map(resolve)
      .filter(declaration => declaration);
  }

  if (entryComponents && entryComponents.length) {
    mockedModuleDef.entryComponents = flatten(entryComponents)
      .map(resolve)
      .filter(declaration => declaration);
  }

  if (bootstrap && bootstrap.length) {
    mockedModuleDef.bootstrap = flatten(bootstrap)
      .map(resolve)
      .filter(declaration => declaration);
  }

  if (providers && providers.length) {
    mockedModuleDef.providers = flatten(providers)
      .map(resolveProvider)
      .filter(declaration => declaration);
  }

  // mock of imports should be the latest step before exports to ensure that everything has been mocked already
  if (imports && imports.length) {
    mockedModuleDef.imports = flatten(imports)
      .map(resolve)
      .filter(declaration => declaration);
  }

  // Default exports.
  if (exports && exports.length) {
    mockedModuleDef.exports = flatten(exports)
      .map(resolve)
      .filter(declaration => declaration);
  }

  // if we are in the skipMock mode we need to export only the default exports.
  // if we are in the correctModuleExports mode we need to export only default exports.
  const correctExports = ngMocksUniverse.flags.has('skipMock') || ngMocksUniverse.flags.has('correctModuleExports');

  // When we mock a module, only exported declarations are accessible inside of a test.
  // Because of that we have to export whatever a module imports or declares.
  // Unfortunately, in this case tests won't fail when a module has missed exports.
  // MockBuilder doesn't have have this issue.
  for (const def of flatten([imports, declarations])) {
    const moduleConfig = ngMocksUniverse.config.get(ngModule) || {};
    const instance = isNgModuleDefWithProviders(def) ? def.ngModule : def;
    const mockedDef = resolve(instance);
    if (!mockedDef) {
      continue;
    }

    // If we export a declaration, then we have to export its module too.
    const config = ngMocksUniverse.config.get(instance) || {};
    if (config.export && ngModule) {
      if (!moduleConfig.export) {
        ngMocksUniverse.config.set(ngModule, {
          ...moduleConfig,
          export: true,
        });
      }
    }

    if (correctExports && !config.export && !moduleConfig.exportAll) {
      continue;
    }
    if (mockedModuleDef.exports && mockedModuleDef.exports.indexOf(mockedDef) !== -1) {
      continue;
    }

    changed = true;
    mockedModuleDef.exports = mockedModuleDef.exports || [];
    mockedModuleDef.exports.push(mockedDef);
  }

  return [changed, mockedModuleDef];
}
