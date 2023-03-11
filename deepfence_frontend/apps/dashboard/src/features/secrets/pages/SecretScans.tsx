import cx from 'classnames';
import dayjs from 'dayjs';
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { IconContext } from 'react-icons';
import { FiFilter } from 'react-icons/fi';
import {
  HiArchive,
  HiArrowSmLeft,
  HiClock,
  HiDotsVertical,
  HiDownload,
  HiOutlineExclamationCircle,
  HiRefresh,
} from 'react-icons/hi';
import {
  ActionFunctionArgs,
  Form,
  LoaderFunctionArgs,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  CircleSpinner,
  createColumnHelper,
  Dropdown,
  DropdownItem,
  IconButton,
  Modal,
  Popover,
  Select,
  SortingState,
  Table,
  TableSkeleton,
} from 'ui-components';
import { Checkbox, SelectItem } from 'ui-components';

import { getScanResultsApiClient, getSearchApiClient } from '@/api/api';
import {
  ApiDocsBadRequestResponse,
  ModelScanInfo,
  ModelScanResultsActionRequestScanTypeEnum,
  SearchSearchScanReq,
} from '@/api/generated';
import { DFLink } from '@/components/DFLink';
import { SecretsIcon } from '@/components/sideNavigation/icons/Secrets';
import { SEVERITY_COLORS } from '@/constants/charts';
import { useGetClustersList } from '@/features/common/data-component/searchClustersApiLoader';
import { useGetContainerImagesList } from '@/features/common/data-component/searchContainerImagesApiLoader';
import { useGetContainersList } from '@/features/common/data-component/searchContainersApiLoader';
import { useGetHostsList } from '@/features/common/data-component/searchHostsApiLoader';
import { IconMapForNodeType } from '@/features/onboard/components/IconMapForNodeType';
import { ApiError, makeRequest } from '@/utils/api';
import { formatMilliseconds } from '@/utils/date';
import { typedDefer, TypedDeferredData } from '@/utils/router';
import { DFAwait } from '@/utils/suspense';
import {
  getOrderFromSearchParams,
  getPageFromSearchParams,
  useSortingState,
} from '@/utils/table';

export interface FocusableElement {
  focus(options?: FocusOptions): void;
}

enum ActionEnumType {
  DELETE = 'delete',
  DOWNLOAD = 'download',
}

const PAGE_SIZE = 15;

enum NodeTypeEnum {
  Host = 'host',
  Container = 'container',
  Image = 'image',
}

type ScanResult = ModelScanInfo & {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
};

export type LoaderDataType = {
  error?: string;
  message?: string;
  data: Awaited<ReturnType<typeof getScans>>;
};

const getStatusSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('status').map((status) => status.toUpperCase());
};
const getHostsSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('hosts');
};
const getContainersSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('containers');
};
const getContainerImagesSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('containerImages');
};
const getLanguagesSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('languages');
};
const getClustersSearch = (searchParams: URLSearchParams) => {
  return searchParams.getAll('clusters');
};

async function getScans(
  nodeTypes: NodeTypeEnum[],
  searchParams: URLSearchParams,
): Promise<{
  scans: ScanResult[];
  currentPage: number;
  totalRows: number;
  message?: string;
}> {
  const results: {
    scans: ScanResult[];
    currentPage: number;
    totalRows: number;
    message?: string;
  } = {
    scans: [],
    currentPage: 1,
    totalRows: 0,
  };
  const status = getStatusSearch(searchParams);
  const scanFilters = {} as {
    status?: string[];
  };
  if (status.length > 0) {
    scanFilters.status = status;
  }

  const nodeFilters = {
    node_type: nodeTypes,
  } as {
    status?: string[];
    node_type?: string[];
    node_id?: string[];
    kubernetes_cluster_id?: string[];
  };
  const hosts = getHostsSearch(searchParams);
  const containers = getContainersSearch(searchParams);
  const images = getContainerImagesSearch(searchParams);
  const languages = getLanguagesSearch(searchParams);
  const clusters = getClustersSearch(searchParams);

  const page = getPageFromSearchParams(searchParams);
  const order = getOrderFromSearchParams(searchParams);

  if (hosts && hosts?.length > 0) {
    nodeFilters.node_id = nodeFilters.node_id ? nodeFilters.node_id.concat(hosts) : hosts;
  }
  if (containers && containers?.length > 0) {
    nodeFilters.node_id = nodeFilters.node_id
      ? nodeFilters.node_id.concat(containers)
      : containers;
  }
  if (images && images?.length > 0) {
    nodeFilters.node_id = nodeFilters.node_id
      ? nodeFilters.node_id.concat(images)
      : images;
  }
  if (languages && languages?.length > 0) {
    nodeFilters.node_id = nodeFilters.node_id
      ? nodeFilters.node_id.concat(languages)
      : languages;
  }

  if (clusters && clusters?.length > 0) {
    nodeFilters.kubernetes_cluster_id = clusters;
  }

  const languageFilters = {} as {
    trigger_action: string[];
  };
  if (languages && languages.length > 0) {
    languageFilters.trigger_action = languages;
  }

  const scanRequestParams: SearchSearchScanReq = {
    node_filters: {
      filters: {
        contains_filter: { filter_in: { ...nodeFilters } },
        order_filter: { order_fields: [] },
        match_filter: { filter_in: {} },
      },
      in_field_filter: null,
    },
    scan_filters: {
      filters: {
        contains_filter: { filter_in: { ...scanFilters } },
        order_filter: { order_fields: [] },
        match_filter: { filter_in: { ...languageFilters } },
      },
      in_field_filter: null,
    },
    window: { offset: page * PAGE_SIZE, size: PAGE_SIZE },
  };

  if (order) {
    scanRequestParams.scan_filters.filters.order_filter.order_fields = [
      {
        field_name: order.sortBy,
        descending: order.descending,
      },
    ];
  }

  const result = await makeRequest({
    apiFunction: getSearchApiClient().searchSecretsScan,
    apiArgs: [{ searchSearchScanReq: scanRequestParams }],
    errorHandler: async (r) => {
      const error = new ApiError(results);
      if (r.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse = await r.json();
        return error.set({
          ...results,
          message: modelResponse.message,
        });
      }
    },
  });

  if (ApiError.isApiError(result)) {
    throw result.value();
  }

  const countsResult = await makeRequest({
    apiFunction: getSearchApiClient().searchSecretScanCount,
    apiArgs: [
      {
        searchSearchScanReq: {
          ...scanRequestParams,
          window: {
            ...scanRequestParams.window,
            size: 10 * scanRequestParams.window.size,
          },
        },
      },
    ],
    errorHandler: async (r) => {
      const error = new ApiError(results);
      if (r.status === 400) {
        const modelResponse: ApiDocsBadRequestResponse = await r.json();
        return error.set({
          ...results,
          message: modelResponse.message,
        });
      }
    },
  });

  if (ApiError.isApiError(countsResult)) {
    throw countsResult.value();
  }

  if (result === null) {
    return results;
  }

  results.scans = result.map((scan) => {
    const severities = scan.severity_counts as {
      critical: number;
      high: number;
      medium: number;
      low: number;
      unknown: number;
    };
    severities.critical = severities.critical ?? 0;
    severities.high = severities.high ?? 0;
    severities.medium = severities.medium ?? 0;
    severities.low = severities.low ?? 0;
    severities.unknown = severities.unknown ?? 0;

    return {
      ...scan,
      total: severities.critical + severities.high + severities.medium + severities.low,
      critical: severities.critical,
      high: severities.high,
      medium: severities.medium,
      low: severities.low,
      unknown: severities.unknown,
    };
  });

  results.currentPage = page;
  results.totalRows = page * PAGE_SIZE + countsResult.count;

  return results;
}

const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<TypedDeferredData<LoaderDataType>> => {
  const searchParams = new URL(request.url).searchParams;

  const nodeType = searchParams.getAll('nodeType').length
    ? searchParams.getAll('nodeType')
    : ['container_image', 'container', 'host'];

  return typedDefer({
    data: getScans(nodeType as NodeTypeEnum[], searchParams),
  });
};

const action = async ({
  request,
}: ActionFunctionArgs): Promise<{
  url: string;
} | null> => {
  const formData = await request.formData();
  const actionType = formData.get('actionType');
  const scanId = formData.get('scanId');
  const nodeId = formData.get('nodeId');
  if (!actionType || !scanId || !nodeId) {
    throw new Error('Invalid action');
  }

  if (actionType === ActionEnumType.DELETE) {
    const result = await makeRequest({
      apiFunction: getScanResultsApiClient().deleteScanResultsForScanID,
      apiArgs: [
        {
          scanId: scanId.toString(),
          scanType: ModelScanResultsActionRequestScanTypeEnum.SecretScan,
        },
      ],
      errorHandler: async (r) => {
        const error = new ApiError<{
          message?: string;
        }>({});
        if (r.status === 400 || r.status === 409) {
          const modelResponse: ApiDocsBadRequestResponse = await r.json();
          return error.set({
            message: modelResponse.message ?? '',
          });
        }
      },
    });
    if (ApiError.isApiError(result)) {
      if (result.value()?.message !== undefined) {
        const message = result.value()?.message ?? 'Something went wrong';
        toast.error(message);
      }
    }

    toast.success('Scan deleted successfully');
    return null;
  } else if (actionType === ActionEnumType.DOWNLOAD) {
    const result = await makeRequest({
      apiFunction: getScanResultsApiClient().downloadScanResultsForScanID,
      apiArgs: [
        {
          scanId: scanId.toString(),
          scanType: ModelScanResultsActionRequestScanTypeEnum.SecretScan,
        },
      ],
      errorHandler: async (r) => {
        const error = new ApiError<{
          message?: string;
        }>({});
        if (r.status === 400 || r.status === 409) {
          const modelResponse: ApiDocsBadRequestResponse = await r.json();
          return error.set({
            message: modelResponse.message ?? '',
          });
        }
      },
    });
    if (ApiError.isApiError(result)) {
      if (result.value()?.message !== undefined) {
        const message = result.value()?.message ?? 'Something went wrong';
        toast.error(message);
      }
    }

    toast.success('Download is in progress');
    const a = document.createElement('a');
    const unixTime = dayjs(new Date()).unix();
    a.href = 'https://64.227.142.80/deepfence/openapi.json';
    a.download = `secret_scan_${unixTime}`;
    a.click();
    // TODO: Add download link
    return null;
  }
  return null;
};

const ScanFromDropdown = () => {
  return (
    <Dropdown
      triggerAsChild={true}
      content={
        <>
          <DropdownItem className="text-xs">Last 12 hours</DropdownItem>
          <DropdownItem className="text-xs">Last 24 hours</DropdownItem>
          <DropdownItem className="text-xs">Last 7 days</DropdownItem>
          <DropdownItem className="text-xs">Last 30 days</DropdownItem>
          <DropdownItem className="text-xs">Last 60 days</DropdownItem>
          <DropdownItem className="text-xs">Last 90 days</DropdownItem>
          <DropdownItem className="text-xs">Last 6 months</DropdownItem>
          <DropdownItem className="text-xs">Show All</DropdownItem>
        </>
      }
    >
      <IconButton
        className="ml-auto rounded-lg"
        size="xs"
        outline
        color="primary"
        icon={<HiClock />}
      />
    </Dropdown>
  );
};

const RefreshApiButton = () => {
  const revalidator = useRevalidator();
  return (
    <IconButton
      className="ml-auto rounded-lg"
      size="xs"
      outline
      color="primary"
      onClick={() => revalidator.revalidate()}
      loading={revalidator.state === 'loading'}
      icon={<HiRefresh />}
    />
  );
};

const DeleteConfirmationModal = ({
  showDialog,
  scanId,
  nodeId,
  setShowDialog,
}: {
  showDialog: boolean;
  scanId: string;
  nodeId: string;
  setShowDialog: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const fetcher = useFetcher();

  const onDeleteAction = useCallback(
    (actionType: string) => {
      const formData = new FormData();
      formData.append('actionType', actionType);
      formData.append('scanId', scanId);
      formData.append('nodeId', nodeId);
      fetcher.submit(formData, {
        method: 'post',
      });
    },
    [scanId, nodeId, fetcher],
  );

  return (
    <Modal open={showDialog} onOpenChange={() => setShowDialog(false)}>
      <div className="grid place-items-center">
        <IconContext.Provider
          value={{
            className: 'mb-3 dark:text-red-600 text-red-400 w-[70px] h-[70px]',
          }}
        >
          <HiOutlineExclamationCircle />
        </IconContext.Provider>
        <h3 className="mb-4 font-normal text-center text-sm">
          Selected scan will be deleted.
          <br />
          <span>Are you sure you want to delete?</span>
        </h3>
        <div className="flex items-center justify-right gap-4">
          <Button size="xs" onClick={() => setShowDialog(false)}>
            No, cancel
          </Button>
          <Button
            size="xs"
            color="danger"
            onClick={() => {
              onDeleteAction(ActionEnumType.DELETE);
              setShowDialog(false);
            }}
          >
            Yes, I&apos;m sure
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const ActionDropdown = ({
  icon,
  scanId,
  nodeId,
}: {
  icon: React.ReactNode;
  scanId: string;
  nodeId: string;
}) => {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const onDownloadAction = useCallback(() => {
    const formData = new FormData();
    formData.append('actionType', ActionEnumType.DOWNLOAD);
    formData.append('scanId', scanId);
    formData.append('nodeId', nodeId);
    fetcher.submit(formData, {
      method: 'post',
    });
  }, [scanId, nodeId, fetcher]);

  useEffect(() => {
    if (fetcher.state === 'idle') setOpen(false);
  }, [fetcher]);

  return (
    <>
      <DeleteConfirmationModal
        showDialog={showDeleteDialog}
        scanId={scanId}
        nodeId={nodeId}
        setShowDialog={setShowDeleteDialog}
      />
      <Dropdown
        triggerAsChild
        align="end"
        open={open}
        onOpenChange={setOpen}
        content={
          <>
            <DropdownItem
              className="text-sm"
              onClick={(e) => {
                e.preventDefault();
                onDownloadAction();
              }}
            >
              <span className="flex items-center gap-x-2">
                <HiDownload />
                Download
              </span>
            </DropdownItem>
            <DropdownItem className="text-sm" onClick={() => setShowDeleteDialog(true)}>
              <span className="flex items-center gap-x-2 text-red-700 dark:text-red-400">
                <IconContext.Provider
                  value={{ className: 'text-red-700 dark:text-red-400' }}
                >
                  <HiArchive />
                </IconContext.Provider>
                Delete
              </span>
            </DropdownItem>
          </>
        }
      >
        <Button className="ml-auto" size="xs" color="normal">
          <IconContext.Provider value={{ className: 'text-gray-700 dark:text-gray-400' }}>
            {icon}
          </IconContext.Provider>
        </Button>
      </Dropdown>
    </>
  );
};

const SecretScans = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const elementToFocusOnClose = useRef(null);
  const loaderData = useLoaderData() as LoaderDataType;
  const navigation = useNavigation();
  const [sort, setSort] = useSortingState();

  const columnHelper = createColumnHelper<ScanResult>();

  const { hosts, status: listHostStatus } = useGetHostsList({
    scanType: ModelScanResultsActionRequestScanTypeEnum.SecretScan,
  });
  const { containerImages, status: listContainerImageStatus } = useGetContainerImagesList(
    {
      scanType: ModelScanResultsActionRequestScanTypeEnum.SecretScan,
    },
  );
  const { containers, status: listContainerStatus } = useGetContainersList({
    scanType: ModelScanResultsActionRequestScanTypeEnum.SecretScan,
  });
  const { clusters, status: listClusterStatus } = useGetClustersList();

  const columns = useMemo(() => {
    const columns = [
      columnHelper.accessor('node_type', {
        cell: (info) => {
          return (
            <div className="flex items-center gap-x-2">
              <div className="bg-blue-100 dark:bg-blue-500/10 p-1.5 rounded-lg">
                <IconContext.Provider
                  value={{ className: 'w-4 h-4 text-blue-500 dark:text-blue-400' }}
                >
                  {IconMapForNodeType[info.getValue()]}
                </IconContext.Provider>
              </div>
              <span className="flex-1 truncate capitalize">
                {info.getValue()?.replaceAll('_', ' ')}
              </span>
            </div>
          );
        },
        header: () => 'Type',
        minSize: 100,
        size: 120,
        maxSize: 130,
      }),
      columnHelper.accessor('node_id', {
        enableSorting: false,
        cell: (info) => {
          const isScanComplete = info.row.original.status?.toLowerCase() === 'complete';
          const WrapperComponent = ({ children }: { children: React.ReactNode }) => {
            if (isScanComplete) {
              return (
                <DFLink to={`/secret/scan-results/${info.row.original.scan_id}`}>
                  {children}
                </DFLink>
              );
            }
            return <>{children}</>;
          };
          return (
            <WrapperComponent>
              <div className="flex items-center gap-x-2 truncate">
                <span className="truncate">{info.getValue()}</span>
              </div>
            </WrapperComponent>
          );
        },
        header: () => 'Name',
        minSize: 300,
        size: 300,
        maxSize: 500,
      }),
      columnHelper.accessor('updated_at', {
        cell: (info) => (
          <div className="flex items-center gap-x-2">
            <IconContext.Provider value={{ className: 'text-gray-400' }}>
              <HiClock />
            </IconContext.Provider>
            <span className="truncate">{formatMilliseconds(info.getValue())}</span>
          </div>
        ),
        header: () => 'Timestamp',
        minSize: 140,
        size: 170,
        maxSize: 200,
      }),
      columnHelper.accessor('status', {
        enableSorting: true,
        cell: (info) => (
          <Badge
            label={info.getValue().toUpperCase().replaceAll('_', ' ')}
            className={cx({
              'bg-green-100 dark:bg-green-600/10 text-green-600 dark:text-green-400':
                info.getValue().toLowerCase() === 'complete',
              'bg-red-100 dark:bg-red-600/10 text-red-600 dark:text-red-400':
                info.getValue().toLowerCase() === 'error',
              'bg-blue-100 dark:bg-blue-600/10 text-blue-600 dark:text-blue-400':
                info.getValue().toLowerCase() === 'in_progress',
            })}
            size="sm"
          />
        ),
        header: () => 'Status',
        minSize: 100,
        size: 110,
        maxSize: 110,
        enableResizing: false,
      }),
      columnHelper.accessor('total', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div className="w-5 h-5 text-gray-400 shrink-0">
              <SecretsIcon />
            </div>
          </div>
        ),
        header: () => <div className="text-right truncate">Total</div>,
        minSize: 80,
        size: 80,
        maxSize: 80,
      }),
      columnHelper.accessor('critical', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: SEVERITY_COLORS['critical'],
              }}
            ></div>
          </div>
        ),
        header: () => '',
        minSize: 65,
        size: 65,
        maxSize: 65,
        enableResizing: false,
      }),
      columnHelper.accessor('high', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: SEVERITY_COLORS['high'],
              }}
            ></div>
          </div>
        ),
        header: () => '',
        minSize: 65,
        size: 65,
        maxSize: 65,
        enableResizing: false,
      }),
      columnHelper.accessor('medium', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: SEVERITY_COLORS['medium'],
              }}
            ></div>
          </div>
        ),
        header: () => '',
        minSize: 65,
        size: 65,
        maxSize: 65,
        enableResizing: false,
      }),
      columnHelper.accessor('low', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: SEVERITY_COLORS['low'],
              }}
            ></div>
          </div>
        ),
        header: () => '',
        minSize: 65,
        size: 65,
        maxSize: 65,
        enableResizing: false,
      }),
      columnHelper.accessor('unknown', {
        enableSorting: false,
        cell: (info) => (
          <div className="flex items-center justify-end gap-x-2 tabular-nums">
            <span className="truncate">{info.getValue()}</span>
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: SEVERITY_COLORS['unknown'],
              }}
            ></div>
          </div>
        ),
        header: () => '',
        minSize: 65,
        size: 65,
        maxSize: 65,
        enableResizing: false,
      }),
      columnHelper.display({
        id: 'actions',
        enableSorting: false,
        cell: (cell) => (
          <ActionDropdown
            icon={<HiDotsVertical />}
            scanId={cell.row.original.scan_id}
            nodeId={cell.row.original.node_id}
          />
        ),
        header: () => '',
        minSize: 50,
        size: 50,
        maxSize: 50,
        enableResizing: false,
      }),
    ];

    return columns;
  }, []);

  const isFilterApplied =
    searchParams.has('languages') ||
    searchParams.has('containerImages') ||
    searchParams.has('containers') ||
    searchParams.has('nodeType') ||
    searchParams.has('hosts') ||
    searchParams.has('clusters');

  return (
    <div>
      <div className="flex p-1 pl-2 w-full items-center shadow bg-white dark:bg-gray-800">
        <DFLink
          to={'/secret'}
          className="flex hover:no-underline items-center justify-center mr-2"
        >
          <IconContext.Provider
            value={{
              className: 'w-5 h-5 text-blue-600 dark:text-blue-500 ',
            }}
          >
            <HiArrowSmLeft />
          </IconContext.Provider>
        </DFLink>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          SECRET SCANS
        </span>
        <span className="ml-2">
          {navigation.state === 'loading' ? <CircleSpinner size="xs" /> : null}
        </span>
        <div className="ml-auto flex gap-x-4">
          <ScanFromDropdown />
          <RefreshApiButton />
          <div className="relative gap-x-4">
            {isFilterApplied && (
              <span className="absolute -left-[2px] -top-[2px] inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75"></span>
            )}

            <Popover
              triggerAsChild
              elementToFocusOnCloseRef={elementToFocusOnClose}
              content={
                <div className="dark:text-white p-4">
                  <Form className="flex flex-col gap-y-6">
                    <fieldset>
                      <legend className="text-sm font-medium">Type</legend>
                      <div className="flex gap-x-4">
                        <Checkbox
                          label="Host"
                          checked={searchParams.getAll('nodeType').includes('host')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('nodeType', 'host');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('nodeType');
                                prev.delete('nodeType');
                                prevStatuses
                                  .filter((status) => status !== 'host')
                                  .forEach((status) => {
                                    prev.append('nodeType', status);
                                  });
                                prev.delete('page');
                                return prev;
                              });
                            }
                          }}
                        />
                        <Checkbox
                          label="Container"
                          checked={searchParams.getAll('nodeType').includes('container')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('nodeType', 'container');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('nodeType');
                                prev.delete('nodeType');
                                prevStatuses
                                  .filter((status) => status !== 'container')
                                  .forEach((status) => {
                                    prev.append('nodeType', status);
                                  });
                                prev.delete('page');
                                return prev;
                              });
                            }
                          }}
                        />
                        <Checkbox
                          label="Container Images"
                          checked={searchParams
                            .getAll('nodeType')
                            .includes('container_image')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('nodeType', 'container_image');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('nodeType');
                                prev.delete('page');
                                prev.delete('nodeType');
                                prevStatuses
                                  .filter((status) => status !== 'container_image')
                                  .forEach((status) => {
                                    prev.append('nodeType', status);
                                  });
                                return prev;
                              });
                            }
                          }}
                        />
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="text-sm font-medium">Status</legend>
                      <div className="flex gap-x-4">
                        <Checkbox
                          label="Completed"
                          checked={searchParams.getAll('status').includes('complete')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('status', 'complete');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('status');
                                prev.delete('status');
                                prev.delete('page');
                                prevStatuses
                                  .filter((status) => status !== 'complete')
                                  .forEach((status) => {
                                    prev.append('status', status);
                                  });
                                return prev;
                              });
                            }
                          }}
                        />
                        <Checkbox
                          label="In Progress"
                          checked={searchParams.getAll('status').includes('in_progress')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('status', 'in_progress');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('status');
                                prev.delete('status');
                                prevStatuses
                                  .filter((status) => status !== 'in_progress')
                                  .forEach((status) => {
                                    prev.append('status', status);
                                  });
                                prev.delete('page');
                                return prev;
                              });
                            }
                          }}
                        />
                        <Checkbox
                          label="Error"
                          checked={searchParams.getAll('status').includes('error')}
                          onCheckedChange={(state) => {
                            if (state) {
                              setSearchParams((prev) => {
                                prev.append('status', 'error');
                                prev.delete('page');
                                return prev;
                              });
                            } else {
                              setSearchParams((prev) => {
                                const prevStatuses = prev.getAll('status');
                                prev.delete('status');
                                prev.delete('page');
                                prevStatuses
                                  .filter((status) => status !== 'error')
                                  .forEach((status) => {
                                    prev.append('status', status);
                                  });
                                return prev;
                              });
                            }
                          }}
                        />
                      </div>
                    </fieldset>
                    <fieldset>
                      {listHostStatus === 'submitting' ? (
                        <CircleSpinner size="xs" />
                      ) : (
                        <Select
                          noPortal
                          name="host"
                          label={'Host'}
                          placeholder="Select host"
                          sizing="xs"
                          value={searchParams.getAll('hosts')}
                          onChange={(value) => {
                            setSearchParams((prev) => {
                              prev.delete('hosts');
                              value.forEach((host) => {
                                prev.append('hosts', host);
                              });
                              prev.delete('page');
                              return prev;
                            });
                          }}
                        >
                          <>
                            {hosts.map((host) => {
                              return (
                                <SelectItem value={host.nodeId} key={host.nodeId}>
                                  {host.hostName}
                                </SelectItem>
                              );
                            })}
                          </>
                        </Select>
                      )}
                    </fieldset>
                    <fieldset>
                      {listContainerStatus === 'submitting' ? (
                        <CircleSpinner size="xs" />
                      ) : (
                        <Select
                          noPortal
                          name="container"
                          label={'Container'}
                          placeholder="Select container"
                          sizing="xs"
                          value={searchParams.getAll('containers')}
                          onChange={(value) => {
                            setSearchParams((prev) => {
                              prev.delete('containers');
                              value.forEach((container) => {
                                prev.append('containers', container);
                              });
                              prev.delete('page');
                              return prev;
                            });
                          }}
                        >
                          {containers.map((container) => {
                            return (
                              <SelectItem value={container.nodeId} key={container.nodeId}>
                                {container.nodeName}
                              </SelectItem>
                            );
                          })}
                        </Select>
                      )}
                    </fieldset>
                    <fieldset>
                      {listContainerImageStatus === 'submitting' ? (
                        <CircleSpinner size="xs" />
                      ) : (
                        <Select
                          noPortal
                          name="image"
                          label={'Image'}
                          placeholder="Select image"
                          sizing="xs"
                          value={searchParams.getAll('containerImages')}
                          onChange={(value) => {
                            setSearchParams((prev) => {
                              prev.delete('containerImages');
                              value.forEach((containerImage) => {
                                prev.append('containerImages', containerImage);
                              });
                              prev.delete('page');
                              return prev;
                            });
                          }}
                        >
                          {containerImages.map?.((image) => {
                            return (
                              <SelectItem value={image.nodeId} key={image.nodeId}>
                                {image.containerImage}
                              </SelectItem>
                            );
                          })}
                        </Select>
                      )}
                    </fieldset>
                    <fieldset>
                      {listClusterStatus === 'submitting' ? (
                        <CircleSpinner size="xs" />
                      ) : (
                        <Select
                          noPortal
                          name="cluster"
                          label={'Cluster'}
                          placeholder="Select cluster"
                          sizing="xs"
                          value={searchParams.getAll('clusters')}
                          onChange={(value) => {
                            setSearchParams((prev) => {
                              prev.delete('clusters');
                              value.forEach((cluster) => {
                                prev.append('clusters', cluster);
                              });
                              prev.delete('page');
                              return prev;
                            });
                          }}
                        >
                          {clusters.map((cluster) => {
                            return (
                              <SelectItem
                                value={cluster.clusterId}
                                key={cluster.clusterId}
                              >
                                {cluster.clusterName}
                              </SelectItem>
                            );
                          })}
                        </Select>
                      )}
                    </fieldset>
                  </Form>
                </div>
              }
            >
              <IconButton
                className="ml-auto rounded-lg"
                size="xs"
                outline
                color="primary"
                ref={elementToFocusOnClose}
                icon={<FiFilter />}
              />
            </Popover>
          </div>
        </div>
      </div>
      <div className="m-2">
        <Suspense fallback={<TableSkeleton columns={7} rows={15} size={'md'} />}>
          <DFAwait resolve={loaderData.data}>
            {(resolvedData: LoaderDataType['data']) => {
              return (
                <Table
                  size="sm"
                  data={resolvedData.scans}
                  columns={columns}
                  enablePagination
                  manualPagination
                  enableColumnResizing
                  totalRows={resolvedData.totalRows}
                  pageSize={PAGE_SIZE}
                  pageIndex={resolvedData.currentPage}
                  onPaginationChange={(updaterOrValue) => {
                    let newPageIndex = 0;
                    if (typeof updaterOrValue === 'function') {
                      newPageIndex = updaterOrValue({
                        pageIndex: resolvedData.currentPage,
                        pageSize: PAGE_SIZE,
                      }).pageIndex;
                    } else {
                      newPageIndex = updaterOrValue.pageIndex;
                    }
                    setSearchParams((prev) => {
                      prev.set('page', String(newPageIndex));
                      return prev;
                    });
                  }}
                  enableSorting
                  manualSorting
                  sortingState={sort}
                  onSortingChange={(updaterOrValue) => {
                    let newSortState: SortingState = [];
                    if (typeof updaterOrValue === 'function') {
                      newSortState = updaterOrValue(sort);
                    } else {
                      newSortState = updaterOrValue;
                    }
                    setSearchParams((prev) => {
                      if (!newSortState.length) {
                        prev.delete('sortby');
                        prev.delete('desc');
                      } else {
                        prev.set('sortby', String(newSortState[0].id));
                        prev.set('desc', String(newSortState[0].desc));
                      }
                      return prev;
                    });
                    setSort(newSortState);
                  }}
                />
              );
            }}
          </DFAwait>
        </Suspense>
      </div>
    </div>
  );
};

export const module = {
  loader,
  action,
  element: <SecretScans />,
};