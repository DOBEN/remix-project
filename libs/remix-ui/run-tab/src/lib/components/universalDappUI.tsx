// eslint-disable-next-line no-use-before-define
import React, { useEffect, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { UdappProps } from '../types'
import { FuncABI } from '@remix-project/core-plugin'
import { CopyToClipboard } from '@remix-ui/clipboard'
import * as remixLib from '@remix-project/remix-lib'
import * as ethJSUtil from '@ethereumjs/util'
import { ContractGUI } from './contractGUI'
import { TreeView, TreeViewItem } from '@remix-ui/tree-view'
import { BN } from 'bn.js'
import { CustomTooltip, is0XPrefixed, isHexadecimal, isNumeric, shortenAddress } from '@remix-ui/helper'
const _paq = (window._paq = window._paq || [])
import { functionSelectors, functionArguments } from 'evmole'
import { guessAbiEncodedData } from "@openchainxyz/abi-guesser";

const txHelper = remixLib.execution.txHelper

export function UniversalDappUI(props: UdappProps) {
  const intl = useIntl()
  const [toggleExpander, setToggleExpander] = useState<boolean>(true)
  const [contractABI, setContractABI] = useState<FuncABI[]>(null)
  const [address, setAddress] = useState<string>('')
  const [expandPath, setExpandPath] = useState<string[]>([])
  const [llIError, setLlIError] = useState<string>('')
  const [calldataValue, setCalldataValue] = useState<string>('')
  const [evmBC, setEvmBC] = useState(null)
  const [instanceBalance, setInstanceBalance] = useState(0)

  const [byteCode, setByteCode] = useState<
    string
  >("6080604052348015600e575f80fd5b50600436106026575f3560e01c8063fae7ab8214602a575b5f80fd5b603960353660046062565b6052565b60405163ffffffff909116815260200160405180910390f35b5f605c826001608a565b92915050565b5f602082840312156071575f80fd5b813563ffffffff811681146083575f80fd5b9392505050565b63ffffffff8181168382160190811115605c57634e487b7160e01b5f52601160045260245ffd");

  const [returnParameterBlob, setReturnParameterBlob] = useState<
    string
  >("000000000000133244915818281501791391132251592492075116982316668");
  const [decodedReturnParameters, setDecodedReturnParameters] = useState<
    any
  >(undefined);

  const decodeReturnParameter = async () => {
    setDecodedReturnParameters(undefined)
    const uint8Array = new Uint8Array(returnParameterBlob.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    // TODO: conversion not yet fully working.
    setDecodedReturnParameters(guessAbiEncodedData(uint8Array))
  }

  const getInputParameterString = (inputParam: { name: string; type: string }[] = []) => {
    const concatenatedString = inputParam.map(param => param.type).join(", ");
    return concatenatedString;
  };

  const decodeFunction = async () => {
    setContractABI(undefined);

    // Decode the function selectors.
    const funcSelectors = functionSelectors(byteCode, 20000000000); // 20000000000 is the gas limit
    if (funcSelectors.length === 0) {
      console.error("Could not find any function selectors in the bytecode.");
      return;
    }

    // Decode the input parameters.
    const interfaces: FuncABI[] = [];

    for (let i = 0; i < funcSelectors.length; i++) {
      const argumentsString = functionArguments(byteCode, funcSelectors[i], 20000000000); // 20000000000 is the gas limit

      const inputParameters: string[] =
        argumentsString.trim() === ""
          ? []
          : Array.from(
            argumentsString.split(",").map((param: string) => param.trim()),
          );

      let inputs: { name: string, type: string }[] = [];

      for (let i = 0; i < inputParameters.length; i++) {
        inputs.push({ name: `var${i}`, type: inputParameters[i] })
      }

      interfaces.push({
        name: '0x' + funcSelectors[i],
        type: 'function',
        inputs,
        stateMutability: 'view'
        // payable?: boolean,
        // constant?: any
      });
    }

    // Look-up the function hashes from the database.
    if (funcSelectors.length > 0) {
      try {

        const response = await fetch(
          `https://api.openchain.xyz/signature-database/v1/lookup?function=${'0x' + funcSelectors.join(",0x")}&filter=false`,
          {
            method: "GET",
            headers: new Headers({ "Content-Type": "application/json" }),
          },
        );

        if (!response.ok) {
          const error = await response.json();
          console.error(
            `Unable to fetch function signatures: ${JSON.stringify(error)}`,
          );
        }

        const abi = await response.json();

        // We compare the decoded functionSelectors with the ones looked up from the database to see if there is a perfect match.
        interfaces.forEach((functionInterface, index) => {
          const potentialFunctions =
            abi.result.function[functionInterface.name] || [];

          let alreadyFoundPerfectMatch = false;
          potentialFunctions.forEach(
            (potentialFunction: { name: string }) => {
              if (!alreadyFoundPerfectMatch) {
                // Find perfect name and input parameter match
                const regex = /\((.*?)\)/;
                const matches = potentialFunction.name.match(regex);

                // Get input parameter types
                if (matches && matches.length > 1) {
                  const parametersString = matches[1];
                  const parameters =
                    parametersString.trim() === ""
                      ? []
                      : parametersString
                        .split(",")
                        .map((param) => param.trim());

                  const parameters2 = functionInterface.inputs.map(input => input.type).join(", ")
                  // If we find a function name where the input parameter perfectly matches the extracted input parameter from the bytecode.
                  // Mark this as the perfect match. We know this is the correct function name for sure.
                  //
                  if (
                    JSON.stringify(parameters).replace(/"/g, "") ===
                    '[' + JSON.stringify(parameters2).replace(/ /g, "").replace(/"/g, "") + ']'
                  ) {
                    const functionName = potentialFunction.name
                      .substring(0, potentialFunction.name.indexOf("("))
                      .trim();
                    interfaces[index].name = functionName;
                    alreadyFoundPerfectMatch = true;
                  }
                }
              }
            },
          );
        });
      } catch (error) {
        console.error(`Error fetching function signatures: ${error}`);
      }
    }

    setContractABI(interfaces);
  }

  useEffect(() => {
    if (!props.instance.abi) {
      const abi = txHelper.sortAbiFunction(props.instance.contractData.abi)

      setContractABI(abi)
    } else {
      setContractABI(props.instance.abi)
    }
    if (props.instance.address) {
      let address =
        (props.instance.address.slice(0, 2) === '0x' ? '' : '0x') +
        // @ts-ignore
        props.instance.address.toString('hex')

      address = ethJSUtil.toChecksumAddress(address)
      setAddress(address)
    }
  }, [props.instance.address])

  useEffect(() => {
    if (props.instance.contractData) {
      setEvmBC(props.instance.contractData.bytecodeObject)
    }
  }, [props.instance.contractData])

  useEffect(() => {
    if (props.instance.balance) {
      setInstanceBalance(props.instance.balance)
    }
  }, [props.instance.balance])

  const sendData = () => {
    setLlIError('')
    const fallback = txHelper.getFallbackInterface(contractABI)
    const receive = txHelper.getReceiveInterface(contractABI)
    const args = {
      funcABI: fallback || receive,
      address: address,
      contractName: props.instance.name,
      contractABI: contractABI
    }
    const amount = props.sendValue

    if (amount !== '0') {
      // check for numeric and receive/fallback
      if (!isNumeric(amount)) {
        return setLlIError(intl.formatMessage({ id: 'udapp.llIError1' }))
      } else if (!receive && !(fallback && fallback.stateMutability === 'payable')) {
        return setLlIError(intl.formatMessage({ id: 'udapp.llIError2' }))
      }
    }
    let calldata = calldataValue

    if (calldata) {
      if (calldata.length < 4 && is0XPrefixed(calldata)) {
        return setLlIError(intl.formatMessage({ id: 'udapp.llIError3' }))
      } else {
        if (is0XPrefixed(calldata)) {
          calldata = calldata.substr(2, calldata.length)
        }
        if (!isHexadecimal(calldata)) {
          return setLlIError(intl.formatMessage({ id: 'udapp.llIError4' }))
        }
      }
      if (!fallback) {
        return setLlIError(intl.formatMessage({ id: 'udapp.llIError5' }))
      }
    }

    if (!receive && !fallback) return setLlIError(intl.formatMessage({ id: 'udapp.llIError6' }))

    // we have to put the right function ABI:
    // if receive is defined and that there is no calldata => receive function is called
    // if fallback is defined => fallback function is called
    if (receive && !calldata) args.funcABI = receive
    else if (fallback) args.funcABI = fallback

    if (!args.funcABI) return setLlIError(intl.formatMessage({ id: 'udapp.llIError7' }))
    runTransaction(false, args.funcABI, null, calldataValue)
  }

  const toggleClass = () => {
    setToggleExpander(!toggleExpander)
  }

  const unsavePinnedContract = async () => {
    await props.plugin.call('fileManager', 'remove', `.deploys/pinned-contracts/${props.plugin.REACT_API.chainId}/${props.instance.address}.json`)
  }

  const remove = async () => {
    if (props.instance.isPinned) {
      await unsavePinnedContract()
      _paq.push(['trackEvent', 'udapp', 'pinContracts', 'removePinned'])
    }
    props.removeInstance(props.index)
  }

  const unpinContract = async () => {
    await unsavePinnedContract()
    _paq.push(['trackEvent', 'udapp', 'pinContracts', 'unpinned'])
    props.unpinInstance(props.index)
  }

  const pinContract = async () => {
    const workspace = await props.plugin.call('filePanel', 'getCurrentWorkspace')
    const objToSave = {
      name: props.instance.name,
      address: props.instance.address,
      abi: props.instance.abi || props.instance.contractData.abi,
      filePath: props.instance.filePath || `${workspace.name}/${props.instance.contractData.contract.file}`,
      pinnedAt: Date.now()
    }
    await props.plugin.call('fileManager', 'writeFile', `.deploys/pinned-contracts/${props.plugin.REACT_API.chainId}/${props.instance.address}.json`, JSON.stringify(objToSave, null, 2))
    _paq.push(['trackEvent', 'udapp', 'pinContracts', `pinned at ${props.plugin.REACT_API.chainId}`])
    props.pinInstance(props.index, objToSave.pinnedAt, objToSave.filePath)
  }

  const runTransaction = (lookupOnly, funcABI: FuncABI, valArr, inputsValues, funcIndex?: number) => {
    if (props.instance.isPinned) _paq.push(['trackEvent', 'udapp', 'pinContracts', 'interactWithPinned'])
    const functionName = funcABI.type === 'function' ? funcABI.name : `(${funcABI.type})`
    const logMsg = `${lookupOnly ? 'call' : 'transact'} to ${props.instance.name}.${functionName}`

    props.runTransactions(
      props.index,
      lookupOnly,
      funcABI,
      inputsValues,
      props.instance.name,
      contractABI,
      props.instance.contractData,
      address,
      logMsg,
      props.mainnetPrompt,
      props.gasEstimationPrompt,
      props.passphrasePrompt,
      funcIndex
    )
  }

  const extractDataDefault = (item, parent?) => {
    const ret: any = {}

    if (BN.isBN(item)) {
      ret.self = item.toString(10)
      ret.children = []
    } else {
      if (item instanceof Array) {
        ret.children = item.map((item, index) => {
          return { key: index, value: item }
        })
        ret.self = 'Array'
        ret.isNode = true
        ret.isLeaf = false
      } else if (item instanceof Object) {
        ret.children = Object.keys(item).map((key) => {
          return { key: key, value: item[key] }
        })
        ret.self = 'Object'
        ret.isNode = true
        ret.isLeaf = false
      } else {
        ret.self = item
        ret.children = null
        ret.isNode = false
        ret.isLeaf = true
      }
    }
    return ret
  }

  const handleExpand = (path: string) => {
    if (expandPath.includes(path)) {
      const filteredPath = expandPath.filter((value) => value !== path)

      setExpandPath(filteredPath)
    } else {
      setExpandPath([...expandPath, path])
    }
  }

  const handleCalldataChange = (e) => {
    const value = e.target.value

    setCalldataValue(value)
  }

  const label = (key: string | number, value: string) => {
    return (
      <div className="d-flex mt-2 flex-row label_item">
        <label className="small font-weight-bold mb-0 pr-1 label_key">{key}:</label>
        <label className="m-0 label_value">{value}</label>
      </div>
    )
  }

  const renderData = (item, parent, key: string | number, keyPath: string) => {
    const data = extractDataDefault(item, parent)
    const children = (data.children || []).map((child, index) => {
      return renderData(child.value, data, child.key, keyPath + '/' + child.key)
    })

    if (children && children.length > 0) {
      return (
        <TreeViewItem id={`treeViewItem${key}`} key={keyPath} label={label(key, data.self)} onClick={() => handleExpand(keyPath)} expand={expandPath.includes(keyPath)}>
          <TreeView id={`treeView${key}`} key={keyPath}>
            {children}
          </TreeView>
        </TreeViewItem>
      )
    } else {
      return <TreeViewItem id={key.toString()} key={keyPath} label={label(key, data.self)} onClick={() => handleExpand(keyPath)} expand={expandPath.includes(keyPath)} />
    }
  }

  return (
    <div
      className={`instance udapp_instance udapp_run-instance border-dark ${toggleExpander ? 'udapp_hidesub' : 'bg-light'}`}
      id={`instance${address}`}
      data-shared="universalDappUiInstance"
      data-id={props.instance.isPinned ? `pinnedInstance${address}` : `unpinnedInstance${address}`}
    >

      <br />
      <textarea
        style={{ width: "100%" }}
        onChange={(e) => setByteCode(e.target.value)}
        defaultValue={"6080604052348015600e575f80fd5b50600436106026575f3560e01c8063fae7ab8214602a575b5f80fd5b603960353660046062565b6052565b60405163ffffffff909116815260200160405180910390f35b5f605c826001608a565b92915050565b5f602082840312156071575f80fd5b813563ffffffff811681146083575f80fd5b9392505050565b63ffffffff8181168382160190811115605c57634e487b7160e01b5f52601160045260245ffd"}
      >
      </textarea>
      <br />

      <button
        id="deployAndRunLLTxSendTransaction"
        data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"
        className="btn udapp_instanceButton p-0 w-50 border-warning text-warning"
        onClick={() => decodeFunction()}
      >
        DECODE INTEFACE (Step 1)
      </button>

      <br />
      <br />
      <br />

      <textarea
        style={{ width: "100%" }}
        onChange={(e) => setReturnParameterBlob(e.target.value)}
        defaultValue={"6080604052348015600e575f80fd5b50600436106026575f3560e01c8063fae7ab8214602a575b5f80fd5b603960353660046062565b6052565b60405163ffffffff909116815260200160405180910390f35b5f605c826001608a565b92915050565b5f602082840312156071575f80fd5b813563ffffffff811681146083575f80fd5b9392505050565b63ffffffff8181168382160190811115605c57634e487b7160e01b5f52601160045260245ffd"}
      >
      </textarea>
      <br />

      <button
        id="deployAndRunLLTxSendTransaction"
        data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"
        className="btn udapp_instanceButton p-0 w-50 border-warning text-warning"
        onClick={() => decodeReturnParameter()}
      >
        DECODE RETURN PARAMETER (Step 2)
      </button>

      {decodedReturnParameters && (
        <>
          <br />
          Found Types:
          <br />
          <div className="udapp_value" data-id="udapp_value">
            {JSON.stringify(decodedReturnParameters)}
          </div>
        </>
      )}

      <br />
      <br />
      <br />

      <div className="udapp_title pb-0 alert alert-secondary">
        <span data-id={`universalDappUiTitleExpander${props.index}`} className="btn udapp_titleExpander" onClick={toggleClass} style={{ padding: "0.45rem" }}>
          <i className={`fas ${toggleExpander ? 'fa-angle-right' : 'fa-angle-down'}`} aria-hidden="true"></i>
        </span>
        <div className="input-group udapp_nameNbuts">
          <div className="udapp_titleText input-group-prepend">
            {props.instance.isPinned ? (<CustomTooltip placement="top" tooltipClasses="text-nowrap" tooltipId="udapp_udappUnpinTooltip" tooltipText={props.instance.isPinned ? `Pinned for network: ${props.plugin.REACT_API.chainId}, at:  ${new Date(props.instance.pinnedAt).toLocaleString()}` : ''}>
              <span className="input-group-text udapp_spanTitleText">
                {props.instance.name} at {shortenAddress(address)}
              </span>
            </CustomTooltip>) : (<span className="input-group-text udapp_spanTitleText">
              {props.instance.name} at {shortenAddress(address)} ({props.context})
            </span>)}
          </div>
          <div className="btn" style={{ padding: '0.15rem' }}>
            <CopyToClipboard tip={intl.formatMessage({ id: 'udapp.copyAddress' })} content={address} direction={'top'} />
          </div>
          {props.instance.isPinned ? (<div className="btn" style={{ padding: '0.15rem', marginLeft: '-0.5rem' }}>
            <CustomTooltip placement="top" tooltipClasses="text-nowrap" tooltipId="udapp_udappUnpinTooltip" tooltipText={<FormattedMessage id="udapp.tooltipTextUnpin" />}>
              <i className="fas fa-thumbtack p-2" aria-hidden="true" data-id="universalDappUiUdappUnpin" onClick={unpinContract}></i>
            </CustomTooltip>
          </div>) : (<div className="btn" style={{ padding: '0.15rem', marginLeft: '-0.5rem' }}>
            <CustomTooltip placement="top" tooltipClasses="text-nowrap" tooltipId="udapp_udappPinTooltip" tooltipText={<FormattedMessage id="udapp.tooltipTextPin" />}>
              <i className="far fa-thumbtack p-2" aria-hidden="true" data-id="universalDappUiUdappPin" onClick={pinContract}></i>
            </CustomTooltip>
          </div>)
          }
        </div>
        <div className="btn" style={{ padding: '0.15rem', marginLeft: '-0.5rem' }}>
          <CustomTooltip placement="top" tooltipClasses="text-nowrap" tooltipId="udapp_udappCloseTooltip" tooltipText={<FormattedMessage id="udapp.tooltipTextRemove" />}>
            <i className="fas fa-times p-2" aria-hidden="true" data-id="universalDappUiUdappClose" onClick={remove}></i>
          </CustomTooltip>
        </div>
      </div>
      <div className="udapp_cActionsWrapper" data-id="universalDappUiContractActionWrapper">
        <div className="udapp_contractActionsContainer">
          <div className="d-flex flex-row justify-content-between align-items-center pb-2" data-id="instanceContractBal">
            <span className="remixui_runtabBalancelabel run-tab">
              <b><FormattedMessage id="udapp.balance" />:</b> {instanceBalance} ETH
            </span>
            <div></div>
            <div className="d-flex align-self-center">
              {props.exEnvironment && props.exEnvironment.startsWith('injected') && (
                <CustomTooltip placement="top" tooltipClasses="text-nowrap" tooltipId="udapp_udappEditTooltip" tooltipText={<FormattedMessage id="udapp.tooltipTextEdit" />}>
                  <i
                    data-id="instanceEditIcon"
                    className="fas fa-edit pr-3"
                    onClick={() => {
                      props.editInstance(props.instance)
                    }}
                  ></i>
                </CustomTooltip>
              )}
            </div>
          </div>
          {props.instance.isPinned && props.instance.pinnedAt ? (
            <div className="d-flex" data-id="instanceContractPinnedAt">
              <label>
                <b><FormattedMessage id="udapp.pinnedAt" />:</b> {(new Date(props.instance.pinnedAt)).toLocaleString()}
              </label>
            </div>
          ) : null}
          {props.instance.isPinned && props.instance.filePath ? (
            <div className="d-flex" data-id="instanceContractFilePath" style={{ textAlign: "start", lineBreak: "anywhere" }}>
              <label>
                <b><FormattedMessage id="udapp.filePath" />:</b> {props.instance.filePath}
              </label>
            </div>
          ) : null}
          {contractABI &&
            contractABI.map((funcABI, index) => {
              if (funcABI.type !== 'function') return null
              const isConstant = funcABI.constant !== undefined ? funcABI.constant : false
              const lookupOnly = funcABI.stateMutability === 'view' || funcABI.stateMutability === 'pure' || isConstant
              const inputs = getInputParameterString(funcABI.inputs);

              return (
                <div key={index}>
                  <ContractGUI
                    getVersion={props.getVersion}
                    funcABI={funcABI}
                    clickCallBack={(valArray: { name: string; type: string }[], inputsValues: string) => {
                      runTransaction(lookupOnly, funcABI, valArray, inputsValues, index)
                    }}
                    inputs={inputs}
                    evmBC={evmBC}
                    lookupOnly={lookupOnly}
                    key={index}
                  />
                  {lookupOnly && (
                    <div className="udapp_value" data-id="udapp_value">
                      <TreeView id="treeView">
                        {Object.keys(props.instance.decodedResponse || {}).map((key) => {
                          const funcIndex = index.toString()
                          const response = props.instance.decodedResponse[key]

                          return key === funcIndex
                            ? Object.keys(response || {}).map((innerkey, index) => {
                              return renderData(props.instance.decodedResponse[key][innerkey], response, innerkey, innerkey)
                            })
                            : null
                        })}
                      </TreeView>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
        <div className="d-flex flex-column">
          <div className="d-flex flex-row justify-content-between mt-2">
            <div className="py-2 border-top d-flex justify-content-start flex-grow-1">
              <FormattedMessage id="udapp.lowLevelInteractions" />
            </div>
            <CustomTooltip
              placement={'bottom-end'}
              tooltipClasses="text-wrap"
              tooltipId="receiveEthDocstoolTip"
              tooltipText={<FormattedMessage id="udapp.tooltipText8" />}
            >
              { // receive method added to solidity v0.6.x. use this as diff.
                props.solcVersion.canReceive === false ? (
                  <a href={`https://solidity.readthedocs.io/en/v${props.solcVersion.version}/contracts.html`} target="_blank" rel="noreferrer">
                    <i aria-hidden="true" className="fas fa-info my-2 mr-1"></i>
                  </a>
                ) : <a href={`https://solidity.readthedocs.io/en/v${props.solcVersion.version}/contracts.html#receive-ether-function`} target="_blank" rel="noreferrer">
                  <i aria-hidden="true" className="fas fa-info my-2 mr-1"></i>
                </a>
              }
            </CustomTooltip>
          </div>
          <div className="d-flex flex-column align-items-start">
            <label className="">CALLDATA</label>
            <div className="d-flex justify-content-end w-100 align-items-center">
              <CustomTooltip
                placement="bottom"
                tooltipClasses="text-nowrap"
                tooltipId="deployAndRunLLTxCalldataInputTooltip"
                tooltipText={<FormattedMessage id="udapp.tooltipText9" />}
              >
                <input id="deployAndRunLLTxCalldata" onChange={handleCalldataChange} className="udapp_calldataInput form-control" />
              </CustomTooltip>
              <CustomTooltip placement="right" tooltipClasses="text-nowrap" tooltipId="deployAndRunLLTxCalldataTooltip" tooltipText={<FormattedMessage id="udapp.tooltipText10" />}>
                <button
                  id="deployAndRunLLTxSendTransaction"
                  data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"
                  className="btn udapp_instanceButton p-0 w-50 border-warning text-warning"
                  onClick={sendData}
                >
                  Transact
                </button>
              </CustomTooltip>
            </div>
          </div>
          <div>
            <label id="deployAndRunLLTxError" className="text-danger my-2">
              {llIError}
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
