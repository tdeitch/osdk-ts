/*
 * Copyright 2026 Palantir Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  ObjectOrInterfaceDefinition,
  ObjectSet,
  Osdk,
  PropertyKeys,
  QueryDefinition,
  QueryMetadata,
  SimplePropertyDef,
} from "@osdk/api";
import { useBatchedFunctionQueries } from "@osdk/react/experimental";
import { useEffect, useMemo, useState } from "react";
import type {
  ColumnDefinition,
  ColumnDefinitionLocator,
} from "../ObjectTableApi.js";

export interface FunctionColumnData {
  [columnId: string]: {
    [objectPrimaryKey: string]: {
      data?: any;
      loading: boolean;
      error?: Error;
    };
  };
}

type FunctionColumnConfig<
  Q extends ObjectOrInterfaceDefinition,
  RDPs extends Record<string, SimplePropertyDef> = Record<string, never>,
  FunctionColumns extends Record<string, QueryDefinition<{}>> = Record<
    string,
    never
  >,
> = {
  queryDefinition: QueryDefinition<any>;
  getParams: (
    objectSet: ObjectSet<Q>,
  ) => FunctionColumns[keyof FunctionColumns] extends QueryDefinition
    ? FunctionColumns[keyof FunctionColumns]["__DefinitionMetadata"] extends
      QueryMetadata
      ? FunctionColumns[keyof FunctionColumns]["__DefinitionMetadata"][
        "parameters"
      ]
    : never
    : never;
  columnIds: Array<{
    columnId: string;
    propertyKey?: string;
    getKey: (
      object: Osdk.Instance<Q, "$allBaseProperties", PropertyKeys<Q>, RDPs>,
    ) => string;
  }>;
};

export function useFunctionColumnsData<
  Q extends ObjectOrInterfaceDefinition,
  RDPs extends Record<string, SimplePropertyDef> = Record<string, never>,
  FunctionColumns extends Record<string, QueryDefinition<{}>> = Record<
    string,
    never
  >,
>(
  objectSet: ObjectSet<Q> | undefined,
  objects:
    | Osdk.Instance<Q, "$allBaseProperties", PropertyKeys<Q>, RDPs>[]
    | undefined,
  columnDefinitions?: Array<ColumnDefinition<Q, RDPs, FunctionColumns>>,
): FunctionColumnData {
  const [data, setData] = useState<FunctionColumnData>({});

  // Extract function column configurations and group by unique query definition
  const functionColumnConfigs = useMemo(() => {
    if (!columnDefinitions) return [];

    // Group columns by their query definition apiName
    const configsByApiName = new Map<
      string,
      FunctionColumnConfig<Q, RDPs, FunctionColumns>
    >();

    columnDefinitions.forEach((colDef) => {
      if (colDef.locator.type === "function") {
        const locator = colDef.locator as
          & ColumnDefinitionLocator<Q, RDPs, FunctionColumns>
          & { type: "function" };

        const apiName = locator.queryDefinition.apiName;
        const existingConfig = configsByApiName.get(apiName);

        if (existingConfig) {
          // Add this column to the existing config
          existingConfig.columnIds.push({
            columnId: String(locator.id),
            propertyKey: locator.propertyKey,
            getKey: locator.getKey,
          });
        } else {
          // Create new config
          configsByApiName.set(apiName, {
            queryDefinition: locator.queryDefinition,
            getParams: locator.getParams as any,
            columnIds: [{
              columnId: String(locator.id),
              propertyKey: locator.propertyKey,
              getKey: locator.getKey,
            }],
          });
        }
      }
    });

    return Array.from(configsByApiName.values());
  }, [columnDefinitions]);

  // Create queries for useBatchedFunctionQueries
  const queries = useMemo(() => {
    if (!objectSet) return [];

    return functionColumnConfigs.map(config => ({
      queryDefinition: config.queryDefinition,
      options: {
        params: config.getParams(objectSet) as any,
        enabled: !!objectSet && !!objects && objects.length > 0,
      },
    }));
  }, [functionColumnConfigs, objectSet, objects]);

  const results = useBatchedFunctionQueries({ queries });

  // Process results into FunctionColumnData format
  useEffect(() => {
    if (
      !objects || objects.length === 0 || functionColumnConfigs.length === 0
    ) {
      return;
    }

    const newData: FunctionColumnData = {};

    // Initialize all columns
    functionColumnConfigs.forEach(config => {
      config.columnIds.forEach(({ columnId }) => {
        newData[columnId] = {};
      });
    });

    // Process each result
    results.forEach((result, index) => {
      const config = functionColumnConfigs[index];

      if (!config) return;

      objects.forEach(obj => {
        const key = String(obj.$primaryKey);

        // Process each column that uses this query result
        config.columnIds.forEach(
          ({ columnId, propertyKey, getKey: columnGetKey }) => {
            if (result.isLoading) {
              newData[columnId][key] = { loading: true };
            } else if (result.error) {
              newData[columnId][key] = {
                loading: false,
                error: result.error,
              };
            } else if (result.data) {
              // Use column-specific getKey function
              const customKey = columnGetKey(obj);
              const rawData = (result.data as any)[customKey];

              let cellData = rawData;

              // If propertyKey is specified, extract that property from custom type
              if (
                propertyKey && cellData && typeof cellData === "object"
              ) {
                cellData = cellData[propertyKey];
              }

              newData[columnId][key] = {
                data: cellData,
                loading: false,
              };
            } else {
              // No data, not loading, no error
              newData[columnId][key] = { loading: false };
            }
          },
        );
      });
    });

    setData(newData);
  }, [results, objects, functionColumnConfigs]);

  return data;
}
