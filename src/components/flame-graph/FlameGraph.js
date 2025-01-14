/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import explicitConnect from '../../utils/connect';
import FlameGraphCanvas from './Canvas';
import {
  getCategories,
  getCommittedRange,
  getPreviewSelection,
  getScrollToSelectionGeneration,
  getProfileInterval,
} from '../../selectors/profile';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import {
  getSelectedThreadIndex,
  getInvertCallstack,
} from '../../selectors/url-state';
import ContextMenuTrigger from '../shared/ContextMenuTrigger';
import { getCallNodePathFromIndex } from '../../profile-logic/profile-data';
import {
  changeSelectedCallNode,
  changeRightClickedCallNode,
} from '../../actions/profile-view';
import { getIconsWithClassNames } from '../../selectors/icons';
import { BackgroundImageStyleDef } from '../shared/StyleDef';

import type { Thread, CategoryList } from '../../types/profile';
import type { Milliseconds } from '../../types/units';
import type { FlameGraphTiming } from '../../profile-logic/flame-graph';
import type { PreviewSelection } from '../../types/actions';
import type {
  CallNodeInfo,
  IndexIntoCallNodeTable,
} from '../../types/profile-derived';
import type { CallTree } from '../../profile-logic/call-tree';
import type { IconWithClassName } from '../../types/state';

import type { ConnectedProps } from '../../utils/connect';

require('./FlameGraph.css');

const STACK_FRAME_HEIGHT = 16;

/**
 * How "wide" a call node box needs to be for it to be able to be
 * selected with keyboard navigation. This is a fraction between 0 and
 * 1, where 1 means the box spans the whole viewport.
 */
const SELECTABLE_THRESHOLD = 0.001;

type StateProps = {|
  +thread: Thread,
  +unfilteredThread: Thread,
  +sampleIndexOffset: number,
  +maxStackDepth: number,
  +timeRange: { start: Milliseconds, end: Milliseconds },
  +previewSelection: PreviewSelection,
  +flameGraphTiming: FlameGraphTiming,
  +callTree: CallTree,
  +callNodeInfo: CallNodeInfo,
  +threadIndex: number,
  +selectedCallNodeIndex: IndexIntoCallNodeTable | null,
  +rightClickedCallNodeIndex: IndexIntoCallNodeTable | null,
  +scrollToSelectionGeneration: number,
  +icons: IconWithClassName[],
  +categories: CategoryList,
  +interval: Milliseconds,
  +isInverted: boolean,
|};
type DispatchProps = {|
  +changeSelectedCallNode: typeof changeSelectedCallNode,
  +changeRightClickedCallNode: typeof changeRightClickedCallNode,
|};
type Props = ConnectedProps<{||}, StateProps, DispatchProps>;

class FlameGraph extends React.PureComponent<Props> {
  _viewport: HTMLDivElement | null = null;

  _onSelectedCallNodeChange = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    const { callNodeInfo, threadIndex, changeSelectedCallNode } = this.props;
    changeSelectedCallNode(
      threadIndex,
      getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
    );
  };

  _onRightClickedCallNodeChange = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    const {
      callNodeInfo,
      threadIndex,
      changeRightClickedCallNode,
    } = this.props;
    changeRightClickedCallNode(
      threadIndex,
      getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
    );
  };

  _shouldDisplayTooltips = () => this.props.rightClickedCallNodeIndex === null;

  _takeViewportRef = (viewport: HTMLDivElement | null) => {
    this._viewport = viewport;
  };

  _focusViewport = () => {
    if (this._viewport) {
      this._viewport.focus();
    }
  };

  /**
   * Is the box for this call node wide enough to be selected?
   */
  _wideEnough = (callNodeIndex: IndexIntoCallNodeTable): boolean => {
    const {
      flameGraphTiming,
      callNodeInfo: { callNodeTable },
    } = this.props;

    const depth = callNodeTable.depth[callNodeIndex];
    const row = flameGraphTiming[depth];
    const columnIndex = row.callNode.indexOf(callNodeIndex);
    return row.end[columnIndex] - row.start[columnIndex] > SELECTABLE_THRESHOLD;
  };

  /**
   * Return next keyboard selectable callNodeIndex along one
   * horizontal direction.
   *
   * `direction` should be either -1 (left) or 1 (right).
   *
   * Returns undefined if no selectable callNodeIndex can be found.
   * This means we're already at the end, or the boxes of all
   * candidate call nodes are too narrow to be selected.
   */
  _nextSelectableInRow = (
    startingCallNodeIndex: IndexIntoCallNodeTable,
    direction: 1 | -1
  ): IndexIntoCallNodeTable | void => {
    const {
      flameGraphTiming,
      callNodeInfo: { callNodeTable },
    } = this.props;

    let callNodeIndex = startingCallNodeIndex;

    const depth = callNodeTable.depth[callNodeIndex];
    const row = flameGraphTiming[depth];
    let columnIndex = row.callNode.indexOf(callNodeIndex);

    do {
      columnIndex += direction;
      callNodeIndex = row.callNode[columnIndex];
      if (
        row.end[columnIndex] - row.start[columnIndex] >
        SELECTABLE_THRESHOLD
      ) {
        // The box for this callNodeIndex is wide enough. We've found
        // a candidate.
        break;
      }
    } while (callNodeIndex !== undefined);

    return callNodeIndex;
  };

  _handleKeyDown = (event: SyntheticKeyboardEvent<HTMLElement>) => {
    const {
      threadIndex,
      callTree,
      callNodeInfo: { callNodeTable },
      selectedCallNodeIndex,
      changeSelectedCallNode,
    } = this.props;

    if (selectedCallNodeIndex === null) {
      if (
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        // Just select the "root" node if we've got no prior selection.
        changeSelectedCallNode(
          threadIndex,
          getCallNodePathFromIndex(0, callNodeTable)
        );
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown': {
        const prefix = callNodeTable.prefix[selectedCallNodeIndex];
        if (prefix !== -1) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(prefix, callNodeTable)
          );
        }
        break;
      }
      case 'ArrowUp': {
        const [callNodeIndex] = callTree.getChildren(selectedCallNodeIndex);
        // The call nodes returned from getChildren are sorted by
        // total time in descending order.  The first one in the
        // array, which is the one we pick, has the longest time and
        // thus the widest box.

        if (callNodeIndex !== undefined && this._wideEnough(callNodeIndex)) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(callNodeIndex, callNodeTable)
          );
        }
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const callNodeIndex = this._nextSelectableInRow(
          selectedCallNodeIndex,
          event.key === 'ArrowLeft' ? -1 : 1
        );

        if (callNodeIndex !== undefined) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(callNodeIndex, callNodeTable)
          );
        }
        break;
      }
      default:
        // Other keys are ignored
        break;
    }
  };

  componentDidMount() {
    this._focusViewport();
  }

  render() {
    const {
      thread,
      unfilteredThread,
      sampleIndexOffset,
      threadIndex,
      maxStackDepth,
      flameGraphTiming,
      callTree,
      callNodeInfo,
      timeRange,
      previewSelection,
      selectedCallNodeIndex,
      scrollToSelectionGeneration,
      icons,
      categories,
      interval,
      isInverted,
    } = this.props;

    const maxViewportHeight = maxStackDepth * STACK_FRAME_HEIGHT;

    return (
      <div className="flameGraphContent" onKeyDown={this._handleKeyDown}>
        {icons.map(({ className, icon }) => (
          <BackgroundImageStyleDef
            className={className}
            url={icon}
            key={className}
          />
        ))}
        <ContextMenuTrigger
          id="CallNodeContextMenu"
          attributes={{
            className: 'treeViewContextMenu',
          }}
        >
          <FlameGraphCanvas
            key={threadIndex}
            // ChartViewport props
            viewportProps={{
              timeRange,
              maxViewportHeight,
              maximumZoom: 1,
              previewSelection,
              startsAtBottom: true,
              disableHorizontalMovement: true,
              viewportNeedsUpdate,
              marginLeft: 0,
              marginRight: 0,
              containerRef: this._takeViewportRef,
            }}
            // FlameGraphCanvas props
            chartProps={{
              thread,
              unfilteredThread,
              sampleIndexOffset,
              maxStackDepth,
              flameGraphTiming,
              callTree,
              callNodeInfo,
              categories,
              selectedCallNodeIndex,
              scrollToSelectionGeneration,
              stackFrameHeight: STACK_FRAME_HEIGHT,
              onSelectionChange: this._onSelectedCallNodeChange,
              onRightClick: this._onRightClickedCallNodeChange,
              shouldDisplayTooltips: this._shouldDisplayTooltips,
              interval,
              isInverted,
            }}
          />
        </ContextMenuTrigger>
      </div>
    );
  }
}

function viewportNeedsUpdate() {
  // By always returning false we prevent the viewport from being
  // reset and scrolled all the way to the bottom when doing
  // operations like changing the time selection or applying a
  // transform.
  return false;
}

export default explicitConnect<{||}, StateProps, DispatchProps>({
  mapStateToProps: state => {
    return {
      thread: selectedThreadSelectors.getFilteredThread(state),
      unfilteredThread: selectedThreadSelectors.getThread(state),
      sampleIndexOffset: selectedThreadSelectors.getSampleIndexOffsetFromCommittedRange(
        state
      ),
      maxStackDepth: selectedThreadSelectors.getCallNodeMaxDepthForFlameGraph(
        state
      ),
      flameGraphTiming: selectedThreadSelectors.getFlameGraphTiming(state),
      callTree: selectedThreadSelectors.getCallTree(state),
      timeRange: getCommittedRange(state),
      previewSelection: getPreviewSelection(state),
      callNodeInfo: selectedThreadSelectors.getCallNodeInfo(state),
      categories: getCategories(state),
      threadIndex: getSelectedThreadIndex(state),
      selectedCallNodeIndex: selectedThreadSelectors.getSelectedCallNodeIndex(
        state
      ),
      rightClickedCallNodeIndex: selectedThreadSelectors.getRightClickedCallNodeIndex(
        state
      ),
      scrollToSelectionGeneration: getScrollToSelectionGeneration(state),
      icons: getIconsWithClassNames(state),
      interval: getProfileInterval(state),
      isInverted: getInvertCallstack(state),
    };
  },
  mapDispatchToProps: {
    changeSelectedCallNode,
    changeRightClickedCallNode,
  },
  component: FlameGraph,
});
